"use client";

import React, { useMemo, useRef, useState, useEffect  } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Play, Grid as GridIcon, Route, Factory, Home, Sandwich, Map as MapIcon, Settings, Wand2 } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

type Cell = { r: number; c: number };
type BuildingKind = "house" | "work" | "food";
type Building = { kind: BuildingKind; r: number; c: number; floors: number; baseCapacity: number };
type Person = { id: number; house?: Building; work?: Building; food?: Building };

function keyOf(r: number, c: number) {
  return `${r},${c}`;
}

function manhattanPath(a: Cell, b: Cell): Cell[] {
  const path: Cell[] = [];
  const dr = a.r <= b.r ? 1 : -1;
  for (let r = a.r; r !== b.r + dr; r += dr) path.push({ r, c: a.c });
  const dc = a.c <= b.c ? 1 : -1;
  for (let c = a.c; c !== b.c + dc; c += dc) path.push({ r: b.r, c });
  return path;
}

// BFS on roads (4-neighbors)
function shortestPathLenCells(
  rows: number,
  cols: number,
  roads: Set<string>,
  start: Cell,
  goal: Cell
): number | null {
  const inBounds = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols;

  const nearestRoad = (cell: Cell): string | null => {
    const sKey = keyOf(cell.r, cell.c);
    if (roads.has(sKey)) return sKey;
    const q: Cell[] = [cell];
    const seen = new Set<string>([sKey]);
    while (q.length) {
      const cur = q.shift()!;
      const nbrs = [
        { r: cur.r + 1, c: cur.c },
        { r: cur.r - 1, c: cur.c },
        { r: cur.r, c: cur.c + 1 },
        { r: cur.r, c: cur.c - 1 },
      ];
      for (const n of nbrs) {
        if (!inBounds(n.r, n.c)) continue;
        const k = keyOf(n.r, n.c);
        if (seen.has(k)) continue;
        if (roads.has(k)) return k;
        seen.add(k);
        q.push(n);
      }
    }
    return null;
  };

  const sKey = nearestRoad(start);
  const gKey = nearestRoad(goal);
  if (!sKey || !gKey) return null;
  if (sKey === gKey) return 0;

  const q: string[] = [sKey];
  const dist = new Map<string, number>([[sKey, 0]]);
  const deltas = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (q.length) {
    const cur = q.shift()!;
    const [r, c] = cur.split(",").map(Number);
    for (const [dr, dc] of deltas) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const nk = keyOf(nr, nc);
      if (!roads.has(nk) || dist.has(nk)) continue;
      dist.set(nk, (dist.get(cur) ?? 0) + 1);
      if (nk === gKey) return dist.get(nk)!;
      q.push(nk);
    }
  }
  return null;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

type Metrics = {
  population: number;
  avg_walk_m_per_day: number;
  avg_drive_m_per_day: number;
  avg_travel_time_min_per_day: number;
  total_emissions_kg_per_day: number;
  drivers_count: number;
  unreachable_legs: number;
  travel_in: number;   // NEW inbound commuters
  travel_out: number;  // NEW outbound commuters
};


export default function MobilityGridWorldUI() {
  // Grid config
  const [rows, setRows] = useState(18);
  const [cols, setCols] = useState(24);
  const [cellSizeM, setCellSizeM] = useState(50);

  // World state
  const [roads, setRoads] = useState<Set<string>>(() => new Set());
  const [buildings, setBuildings] = useState<Building[]>([]);

  // People & sim config
  const [population, setPopulation] = useState(2100);
  const [walkMaxM, setWalkMaxM] = useState(800);
  const [carEmissionsKgPerKm, setCarEmissionsKgPerKm] = useState(0.2);
  const [walkEmissionsKgPerKm, setWalkEmissionsKgPerKm] = useState(0);
  const [carSpeed, setCarSpeed] = useState(35);
  const [walkSpeed, setWalkSpeed] = useState(4.8);
  const [distanceMode, setDistanceMode] = useState<"road" | "euclid" | "manhattan">("road");

  // Workforce / provisioning constraints
  const [jobsPerWorkplace, setJobsPerWorkplace] = useState(80);
  const [mealsPerFoodPlace, setMealsPerFoodPlace] = useState(200);
  // Boundary commuting penalty (kg CO2 per inbound/outbound commuter per day)
const [boundaryPenaltyKgPerPerson, setBoundaryPenaltyKgPerPerson] = useState(15);


  // Budget & cost model for housing
  const [budgetTotal, setBudgetTotal] = useState(5_000_000);
  const [budgetSpent, setBudgetSpent] = useState(0);
  const [houseBaseCost, setHouseBaseCost] = useState(13_000);
  const [capExp, setCapExp] = useState(1.5);
  const [floorExp, setFloorExp] = useState(1.6);
  const [hiRiseThreshold, setHiRiseThreshold] = useState(6);
  const [hiRisePenalty, setHiRisePenalty] = useState(50_000);

  const houseCost = (fl: number, cap: number) => {
    const penalty = fl > hiRiseThreshold ? hiRisePenalty * Math.pow(fl - hiRiseThreshold, 2) : 0;
    return Math.round(houseBaseCost * Math.pow(cap, capExp) * Math.pow(fl, floorExp) + penalty);
  };

  // Toolbar state
  const [tool, setTool] = useState<"road" | "erase" | BuildingKind>("road");
  const [paintMode, setPaintMode] = useState<"draw" | "line">("draw");
  const [floors, setFloors] = useState(3);
  const [baseCapacity, setBaseCapacity] = useState(12);
  const mouseDownRef = useRef(false);
  const [statusMsg, setStatusMsg] = useState<string>("");

  // Derived totals
  const totalHousingCapacity = useMemo(
    () =>
      buildings
        .filter((b) => b.kind === "house")
        .reduce((acc, b) => acc + b.floors * b.baseCapacity, 0),
    [buildings]
  );

  const totalWorkplaces = useMemo(() => buildings.filter((b) => b.kind === "work").length, [buildings]);
  const budgetRevenue = useMemo(() => totalWorkplaces * 2_000_000, [totalWorkplaces]);
  const totalFoodPlaces = useMemo(() => buildings.filter((b) => b.kind === "food").length, [buildings]);

  // Canvas rendering size
  const cellPx = 26;
  const widthPx = cols * cellPx;
  const heightPx = rows * cellPx;

  // Seed default scenario on first load
useEffect(() => {
  const targetRows = 25, targetCols = 30;
  const targetPopulation = 2100;
  const targetBudget = 75_000_000;

  const houseCount = 117, workCount = 32, foodCount = 11;
  const houseFloors = 3, houseBaseCap = 6;
  const capacity_exp = 1.5;
  const base_cost = 13_000;

  // Build roads (auto grid every 3)
  const rds = new Set<string>();
  for (let r = 0; r < targetRows; r++) if (r % 3 === 0) for (let c = 0; c < targetCols; c++) rds.add(keyOf(r, c));
  for (let c = 0; c < targetCols; c++) if (c % 3 === 0) for (let r = 0; r < targetRows; r++) rds.add(keyOf(r, c));

  const occupied = new Set<string>();
  const B: Building[] = [];
  const addIfFree = (kind: BuildingKind, r: number, c: number, fl: number, cap: number) => {
    const k = keyOf(r, c);
    if (rds.has(k) || occupied.has(k)) return false;
    occupied.add(k);
    B.push({ kind, r, c, floors: fl, baseCapacity: cap });
    return true;
  };

  // Houses: bottom-left (avoid roads)
  let placed = 0;
const houseRowStart = Math.floor(targetRows * 0.6);
const houseColEnd   = Math.floor(targetCols * 0.4);

for (let r = targetRows - 1; r >= houseRowStart && placed < houseCount; r--) {
for (let c = houseColEnd - 1; c >= 0 && placed < houseCount; c--) {
    if (addIfFree("house", r, c, houseFloors, houseBaseCap)) placed++;
}
}

// Optional fallback sweep if that region can’t fit all houses
for (let r = targetRows - 1; r >= 0 && placed < houseCount; r--) {
for (let c = targetCols - 1; c >= 0 && placed < houseCount; c--) {
    if (addIfFree("house", r, c, houseFloors, houseBaseCap)) placed++;
}
}

  // Workplaces: top-right (avoid roads)
  placed = 0;
  const workRowEnd = Math.floor(targetRows * 0.4);
  const workColStart = Math.floor(targetCols * 0.6);
  for (let r = 0; r < workRowEnd && placed < workCount; r++) {
    for (let c = workColStart; c < targetCols && placed < workCount; c++) {
      if (addIfFree("work", r, c, 1, 30)) placed++;
    }
  }
  // Fallback sweep
  for (let r = 0; r < targetRows && placed < workCount; r++) {
    for (let c = 0; c < targetCols && placed < workCount; c++) {
      if (addIfFree("work", r, c, 1, 30)) placed++;
    }
  }

  // Food: random locations (avoid roads/occupied)
  const all: string[] = [];
  for (let r = 0; r < targetRows; r++) for (let c = 0; c < targetCols; c++) all.push(keyOf(r, c));
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  placed = 0;
  for (const k of all) {
    if (placed >= foodCount) break;
    if (rds.has(k) || occupied.has(k)) continue;
    const [rr, cc] = k.split(",").map(Number);
    if (addIfFree("food", rr, cc, 1, 50)) placed++;
  }

  // Compute budget spent for seeded housing
  let spent = 0;
  for (const b of B) if (b.kind === "house") spent += houseCost(b.floors, b.baseCapacity);

  // Commit state
  setRows(targetRows);
  setCols(targetCols);
  
  setPopulation(targetPopulation);
  setBudgetTotal(targetBudget);
  setCapExp(capacity_exp);
  setFloors(houseFloors);
  setHouseBaseCost(base_cost);
  setBaseCapacity(houseBaseCap);
  setBudgetSpent(spent); // <-- counts seeded housing
  setRoads(rds);
  setBuildings(B);
  setStatusMsg("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);


  // Painting helpers
  function toggleRoad(r: number, c: number, on?: boolean) {
    setRoads((prev) => {
      const next = new Set(prev);
      const k = keyOf(r, c);
      if (on === undefined) {
        if (next.has(k)) next.delete(k);
        else next.add(k);
      } else {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  function placeBuilding(kind: BuildingKind, r: number, c: number, fl: number, cap: number) {
    setBuildings((prev) => {
      if (prev.some((b) => b.r === r && b.c === c)) return prev;

      // Housing budget check
      if (kind === "house") {
        const cost = houseCost(fl, cap);
        const available = budgetTotal + budgetRevenue - budgetSpent;
        if (cost > available) {
            setStatusMsg(
            `Not enough budget for this house. Cost $${cost.toLocaleString()} | Remaining $${(available - cost).toLocaleString()}`
            );
            return prev;
        }
        setBudgetSpent((s) => s + cost);
      }

      // If there is a road, remove it at this cell
      setRoads((roadsPrev) => {
        const filtered = new Set(roadsPrev);
        filtered.delete(keyOf(r, c));
        return filtered;
      });

      return [...prev, { kind, r, c, floors: fl, baseCapacity: cap }];
    });
  }

    function removeAt(r: number, c: number) {
    setBuildings((prev) => {
        const idx = prev.findIndex((b) => b.r === r && b.c === c);
        if (idx === -1) return prev;
        const b = prev[idx];
        if (b.kind === "house") {
        const refund = houseCost(b.floors, b.baseCapacity);
        setBudgetSpent((s) => Math.max(0, s - refund));
        }
        const next = [...prev];
        next.splice(idx, 1);
        return next;
    });
    setRoads((prev) => {
        const next = new Set(prev);
        next.delete(keyOf(r, c));
        return next;
    });
    }

  const [lineStart, setLineStart] = useState<Cell | null>(null);

  const handleCellDown = (r: number, c: number) => {
    mouseDownRef.current = true;
    setStatusMsg("");
    if (tool === "road") {
      if (paintMode === "draw") toggleRoad(r, c, true);
      else setLineStart({ r, c });
    } else if (tool === "erase") {
      removeAt(r, c);
    } else {
      placeBuilding(tool, r, c, floors, baseCapacity);
    }
  };

  const handleCellEnter = (r: number, c: number) => {
    if (!mouseDownRef.current) return;
    if (tool === "road" && paintMode === "draw") toggleRoad(r, c, true);
    if (tool === "erase") removeAt(r, c);
  };

  const handleMouseUp = (r?: number, c?: number) => {
    if (tool === "road" && paintMode === "line" && lineStart && r !== undefined && c !== undefined) {
      const path = manhattanPath(lineStart, { r, c });
      path.forEach((p) => toggleRoad(p.r, p.c, true));
      setLineStart(null);
    }
    mouseDownRef.current = false;
  };

  const [metrics, setMetrics] = useState<Metrics | null>(null);

  function distanceMeters(a: Cell, b: Cell): number | null {
    if (distanceMode === "euclid") {
      const dx = a.r - b.r, dy = a.c - b.c;
      return Math.hypot(dx, dy) * cellSizeM;
    }
    if (distanceMode === "manhattan") {
      return (Math.abs(a.r - b.r) + Math.abs(a.c - b.c)) * cellSizeM;
    }
    const L = shortestPathLenCells(rows, cols, roads, a, b);
    return L === null ? null : L * cellSizeM;
  }

  function runSimulation() {
    const houses = buildings.filter((b) => b.kind === "house");
    const works = buildings.filter((b) => b.kind === "work");
    const foods = buildings.filter((b) => b.kind === "food");

    if (!houses.length) return setStatusMsg("Place at least one house.");
    if (!works.length) return setStatusMsg("Place at least one workplace.");
    if (!foods.length) return setStatusMsg("Place at least one food place.");

    // Capacity-aware housing
    const totalCap = houses.reduce((s, h) => s + h.floors * h.baseCapacity, 0);
    if (totalCap < population) {
      setMetrics(null);
      return setStatusMsg(
        `Not enough housing capacity (${totalCap}) for population (${population}). Raise floors, base capacity, or add houses.`
      );
    }

    // Workforce & food provisioning constraints
    const needWorkplaces = Math.ceil(population / Math.max(1, jobsPerWorkplace));
    const needFood = Math.ceil(population / Math.max(1, mealsPerFoodPlace));
    if (works.length < needWorkplaces) {
      setMetrics(null);
      return setStatusMsg(`Insufficient workplaces: have ${works.length}, need ${needWorkplaces}.`);
    }
    if (foods.length < needFood) {
      setMetrics(null);
      return setStatusMsg(`Insufficient food places: have ${foods.length}, need ${needFood}.`);
    }
    const livingPeople = population;
    const jobsCapacityInside = totalWorkplaces * Math.max(1, jobsPerWorkplace);
    const travel_in  = Math.max(0, jobsCapacityInside - livingPeople);
    const travel_out = Math.max(0, livingPeople - jobsCapacityInside);

    // Create people
    const people: Person[] = Array.from({ length: population }, (_, i) => ({ id: i }));

    // Assign housing round-robin using expanded capacity
    const expandedHouses: Building[] = houses.flatMap((h) => Array(h.floors * h.baseCapacity).fill(h));
    let idx = 0;
    people.forEach((p) => {
      p.house = expandedHouses[idx++];
    });

    // Assign random work & food (could switch to nearest if you want)
    people.forEach((p) => {
      p.work = works[Math.floor(Math.random() * works.length)];
      p.food = foods[Math.floor(Math.random() * foods.length)];
    });

    let totalWalk = 0, totalDrive = 0, totalTimeH = 0, totalEmissions = 0, drivers = 0, unreachable = 0;

    for (const p of people) {
      const legs: [Cell, Cell][] = [
        [{ r: p.house!.r, c: p.house!.c }, { r: p.work!.r, c: p.work!.c }],
        [{ r: p.work!.r, c: p.work!.c }, { r: p.food!.r, c: p.food!.c }],
        [{ r: p.food!.r, c: p.food!.c }, { r: p.house!.r, c: p.house!.c }],
      ];
      let personDrove = false;
      for (let i = 0; i < 3; i++) {
        const [a, b] = legs[i];
        const d = distanceMeters(a, b);
        if (d === null || !isFinite(d)) {
          unreachable++;
          personDrove = true;
          continue;
        }
        const willDrive = d > walkMaxM;
        const speed = willDrive ? carSpeed : walkSpeed;
        const ePerKm = willDrive ? carEmissionsKgPerKm : walkEmissionsKgPerKm;
        totalTimeH += (d / 1000) / Math.max(speed, 1e-6);
        totalEmissions += (d / 1000) * ePerKm;
        if (willDrive) {
          totalDrive += d; personDrove = true;
        } else {
          totalWalk += d;
        }
      }
      if (personDrove) drivers++;
    }
    const boundaryPenalty = (travel_in + travel_out) * Math.max(0, boundaryPenaltyKgPerPerson);

    setMetrics({
      population,
      avg_walk_m_per_day: totalWalk / Math.max(population, 1),
      avg_drive_m_per_day: totalDrive / Math.max(population, 1),
      avg_travel_time_min_per_day: (totalTimeH / Math.max(population, 1)) * 60,
      total_emissions_kg_per_day: totalEmissions + boundaryPenalty,
      drivers_count: drivers,
      unreachable_legs: unreachable,
      travel_in,
      travel_out,
    });
    setStatusMsg("");
  }

  // Preset / demo setup
  const seedDemo = () => {
    setBuildings([]);
    setRoads(new Set());
    setPopulation(250);
    setWalkMaxM(800);
    setCarSpeed(35);
    setWalkSpeed(4.8);
    setCarEmissionsKgPerKm(0.2);
    setWalkEmissionsKgPerKm(0);
    setBudgetTotal(5_000_000);
    setBudgetSpent(0);

    // grid roads every 3
    const rds = new Set<string>();
    for (let r = 0; r < rows; r++) if (r % 3 === 0) for (let c = 0; c < cols; c++) rds.add(keyOf(r, c));
    for (let c = 0; c < cols; c++) if (c % 3 === 0) for (let r = 0; r < rows; r++) rds.add(keyOf(r, c));
    setRoads(rds);

    const B: Building[] = [];
    const add = (kind: BuildingKind, r: number, c: number, fl: number, cap: number) =>
      B.push({ kind, r, c, floors: fl, baseCapacity: cap });

    // houses
    [[2, 2],[2, 8],[2, 14],[8, 2],[8, 8],[8, 14]].forEach((xy, i) => add("house", xy[0], xy[1], 2 + (i % 3), 12));
    // work
    [[14, 2],[14, 8],[14, 14]].forEach((xy, i) => add("work", xy[0], xy[1], 4 + (i % 2), 30));
    // food
    [[11, 5],[5, 11],[17, 11]].forEach((xy) => add("food", xy[0], xy[1], 1, 50));

    setBuildings(B);
  };

  const chartData = useMemo(() => {
    if (!metrics) return [] as any[];
    return [
      { metric: "Avg walk (m)", value: metrics.avg_walk_m_per_day },
      { metric: "Avg drive (m)", value: metrics.avg_drive_m_per_day },
      { metric: "Avg time (min)", value: metrics.avg_travel_time_min_per_day },
      { metric: "Total CO₂ (kg)", value: metrics.total_emissions_kg_per_day },
    ];
  }, [metrics]);

  return (
    <div className="w-full min-h-screen p-4 md:p-6 lg:p-8 bg-background text-foreground">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Controls */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="bg-card border-border text-card-foreground">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" /> World & Tools
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-foreground">Rows</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={rows} min={6} max={40}
                    onChange={(e) => setRows(clamp(parseInt(e.target.value || "0"), 6, 40))}
                  />
                </div>
                <div>
                  <Label className="text-foreground">Cols</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={cols} min={6} max={40}
                    onChange={(e) => setCols(clamp(parseInt(e.target.value || "0"), 6, 40))}
                  />
                </div>
                <div>
                  <Label className="text-foreground">Cell (m)</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={cellSizeM} min={10} max={200}
                    onChange={(e) => setCellSizeM(clamp(parseInt(e.target.value || "0"), 10, 200))}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button variant={tool === "road" ? "default" : "secondary"} onClick={() => setTool("road")}><Route className="w-4 h-4 mr-1" />Road</Button>
                  <Button variant={tool === "erase" ? "default" : "secondary"} onClick={() => setTool("erase")}><Trash2 className="w-4 h-4 mr-1" />Erase</Button>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={paintMode} onValueChange={(v: any) => setPaintMode(v)}>
                    <SelectTrigger className="w-[120px] bg-input border-border text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draw">Draw</SelectItem>
                      <SelectItem value="line">Line</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="secondary" onClick={() => {
                    const every = 3;
                    setRoads((prev) => {
                      const next = new Set(prev);
                      for (let r = 0; r < rows; r++) if (r % every === 0) for (let c = 0; c < cols; c++) next.add(keyOf(r, c));
                      for (let c = 0; c < cols; c++) if (c % every === 0) for (let r = 0; r < rows; r++) next.add(keyOf(r, c));
                      return next;
                    });
                  }}>
                    <GridIcon className="w-4 h-4 mr-1" />Auto Grid
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Button variant={tool === "house" ? "default" : "secondary"} onClick={() => setTool("house")}><Home className="w-4 h-4 mr-1" />House</Button>
                <Button variant={tool === "work" ? "default" : "secondary"} onClick={() => setTool("work")}><Factory className="w-4 h-4 mr-1" />Work</Button>
                <Button variant={tool === "food" ? "default" : "secondary"} onClick={() => setTool("food")}><Sandwich className="w-4 h-4 mr-1" />Food</Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-foreground">Floors (for placement)</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={floors} min={1} max={30}
                    onChange={(e) => setFloors(clamp(parseInt(e.target.value || "0"), 1, 30))}
                  />
                </div>
                <div>
                  <Label className="text-foreground">Base capacity</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={baseCapacity} min={1} max={200}
                    onChange={(e) => setBaseCapacity(clamp(parseInt(e.target.value || "0"), 1, 200))}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button variant="secondary" onClick={seedDemo}><Wand2 className="w-4 h-4 mr-1" />Load Demo</Button>
                <Button variant="secondary" onClick={() => { setBuildings([]); setRoads(new Set()); setMetrics(null); setBudgetSpent(0); }}>
                  <Trash2 className="w-4 h-4 mr-1" />Clear All
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border text-card-foreground">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MapIcon className="w-5 h-5" /> Mobility Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-foreground">Population</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={population} min={0} max={10000}
                    onChange={(e) => setPopulation(clamp(parseInt(e.target.value || "0"), 0, 10000))}
                  />
                  <p className="text-muted-foreground text-xs mt-1">Housing cap: {totalHousingCapacity}</p>
                </div>
                <div>
                  <Label className="text-foreground">Walk threshold (m)</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={walkMaxM} min={0} max={100000}
                    onChange={(e) => setWalkMaxM(clamp(parseInt(e.target.value || "0"), 0, 100000))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-foreground">Car speed (km/h)</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={carSpeed} min={1} max={200}
                    onChange={(e) => setCarSpeed(clamp(parseInt(e.target.value || "0"), 1, 200))}
                  />
                </div>
                <div>
                  <Label className="text-foreground">Walk speed (km/h)</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={walkSpeed} min={1} max={20}
                    onChange={(e) => setWalkSpeed(clamp(parseInt(e.target.value || "0"), 1, 20))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-foreground">Car CO₂ (kg/km)</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" step="0.01" value={carEmissionsKgPerKm}
                    onChange={(e) => setCarEmissionsKgPerKm(parseFloat(e.target.value || "0"))}
                  />
                </div>
                <div>
                  <Label className="text-foreground">Walk CO₂ (kg/km)</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" step="0.01" value={walkEmissionsKgPerKm}
                    onChange={(e) => setWalkEmissionsKgPerKm(parseFloat(e.target.value || "0"))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-foreground">Distance mode</Label>
                  <Select value={distanceMode} onValueChange={(v: any) => setDistanceMode(v)}>
                    <SelectTrigger className="w-full bg-input border-border text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="road">Road (BFS)</SelectItem>
                      <SelectItem value="euclid">Euclidean</SelectItem>
                      <SelectItem value="manhattan">Manhattan</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                    <Label className="text-foreground">Boundary CO₂ penalty (kg/person)</Label>
                    <Input
                    className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" step="0.1" value={boundaryPenaltyKgPerPerson}
                    onChange={(e) => setBoundaryPenaltyKgPerPerson(parseFloat(e.target.value || "0"))}
                    />
                    <p className="text-muted-foreground text-xs mt-1">
                    Applied to inbound + outbound commuters due to jobs–housing imbalance.
                    </p>
                </div>
                </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-foreground">Jobs / workplace</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={jobsPerWorkplace} min={1}
                    onChange={(e) => setJobsPerWorkplace(Math.max(1, parseInt(e.target.value || "1")))}
                  />
                  <p className="text-muted-foreground text-xs mt-1">
                    Have {totalWorkplaces}, need {Math.ceil(population / Math.max(1, jobsPerWorkplace))}
                  </p>
                </div>
                <div>
                  <Label className="text-foreground">People / food place</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={mealsPerFoodPlace} min={1}
                    onChange={(e) => setMealsPerFoodPlace(Math.max(1, parseInt(e.target.value || "1")))}
                  />
                  <p className="text-muted-foreground text-xs mt-1">
                    Have {totalFoodPlaces}, need {Math.ceil(population / Math.max(1, mealsPerFoodPlace))}
                  </p>
                </div>
              </div>

              <div className="pt-2 text-right">
                <Button onClick={runSimulation}><Play className="w-4 h-4 mr-1" />Run Simulation</Button>
              </div>

              {statusMsg && <p className="text-sm text-red-400">{statusMsg}</p>}
            </CardContent>
          </Card>

          <Card className="bg-card border-border text-card-foreground">
            <CardHeader>
              <CardTitle>Budget & Constraints</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-foreground">Budget ($)</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={budgetTotal}
                    onChange={(e) => setBudgetTotal(parseInt(e.target.value || "0"))}
                  />
                </div>
                <div className="pt-6 text-muted-foreground text-sm">Spent: ${budgetSpent.toLocaleString()}</div>
                <div className="pt-6 text-muted-foreground text-sm">Remain: ${(budgetTotal + budgetRevenue - budgetSpent).toLocaleString()}</div>
              </div>
              <div className="col-span-3 text-neutral-400 text-xs">
                    Revenue from workplaces: ${budgetRevenue.toLocaleString()} (adds to budget)
                </div>


              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-foreground">Base cost</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={houseBaseCost}
                    onChange={(e) => setHouseBaseCost(parseInt(e.target.value || "0"))}
                  />
                </div>
                <div>
                  <Label className="text-foreground">Hi-rise threshold (floors)</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={hiRiseThreshold}
                    onChange={(e) => setHiRiseThreshold(parseInt(e.target.value || "0"))}
                  />
                </div>
                <div>
                  <Label className="text-foreground">Capacity exponent</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" step="0.1" value={capExp}
                    onChange={(e) => setCapExp(parseFloat(e.target.value || "0"))}
                  />
                </div>
                <div>
                  <Label className="text-foreground">Hi-rise penalty</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" value={hiRisePenalty}
                    onChange={(e) => setHiRisePenalty(parseInt(e.target.value || "0"))}
                  />
                </div>
                <div>
                  <Label className="text-foreground">Floors exponent</Label>
                  <Input className="bg-input border-border text-foreground placeholder-muted-foreground focus-visible:ring-ring"
                    type="number" step="0.1" value={floorExp}
                    onChange={(e) => setFloorExp(parseFloat(e.target.value || "0"))}
                  />
                </div>
                <div className="pt-6 text-right">
                  <Button variant="secondary" onClick={() => setBudgetSpent(0)}>Reset Spent</Button>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                House cost preview (floors {floors}, base cap {baseCapacity}) ≈ ${houseCost(floors, baseCapacity).toLocaleString()}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Grid + Results */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-card border-border text-card-foreground">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><GridIcon className="w-5 h-5" />Grid World</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="relative select-none rounded-xl overflow-hidden shadow-inner"
                onMouseLeave={() => handleMouseUp()}
                style={{ width: widthPx, height: heightPx }}
              >
                {/* grid lines */}
                {[...Array(rows)].map((_, r) => (
                  <div key={r} className="absolute left-0 right-0 border-t border-border" style={{ top: r * cellPx }} />
                ))}
                {[...Array(cols)].map((_, c) => (
                  <div key={c} className="absolute top-0 bottom-0 border-l border-border" style={{ left: c * cellPx }} />
                ))}

                {/* cells layer (interaction) */}
                <div className="absolute inset-0" onMouseUp={() => handleMouseUp()}>
                  {[...Array(rows)].map((_, r) => (
                    <div key={r} className="flex" style={{ position: "absolute", top: r * cellPx }}>
                      {[...Array(cols)].map((_, c) => {
                        const k = keyOf(r, c);
                        const isRoad = roads.has(k);
                        const b = buildings.find((bb) => bb.r === r && bb.c === c);
                        return (
                          <div
                            key={c}
                            onMouseDown={() => handleCellDown(r, c)}
                            onMouseEnter={() => handleCellEnter(r, c)}
                            onMouseUp={() => handleMouseUp(r, c)}
                            className="relative"
                            style={{ width: cellPx, height: cellPx, cursor: "crosshair" }}
                          >
                            {/* road fill */}
                            {isRoad && <div className="absolute inset-0 bg-muted" />}
                            {/* building */}
                            {b && (
                              <div
                                className={`absolute inset-[3px] rounded-md flex items-center justify-center text-[10px] font-medium ${
                                  b.kind === "house" ? "bg-emerald-600" : b.kind === "work" ? "bg-blue-600" : "bg-amber-600"
                                }`}
                                title={`${b.kind} | floors ${b.floors} | cap ${b.floors * b.baseCapacity}`}
                              >
                                {b.kind === "house" ? "H" : b.kind === "work" ? "W" : "F"}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Tip: choose a tool (Road/Erase/House/Work/Food). Hold and drag to draw roads. Switch to <em>Line</em> to lay L-shaped roads.
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card className="bg-card border-border text-card-foreground">
              <CardHeader>
                <CardTitle>Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                {metrics ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="p-3 rounded-xl bg-muted">
                      <div className="text-muted-foreground">Population</div>
                      <div className="text-xl font-semibold">{metrics.population}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted">
                      <div className="text-muted-foreground">Drivers</div>
                      <div className="text-xl font-semibold">{metrics.drivers_count}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted">
                      <div className="text-muted-foreground">Unreachable legs</div>
                      <div className="text-xl font-semibold">{metrics.unreachable_legs}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted">
                      <div className="text-muted-foreground">Avg time / day</div>
                      <div className="text-xl font-semibold">{metrics.avg_travel_time_min_per_day.toFixed(1)} min</div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted">
                      <div className="text-muted-foreground">Avg walk / day</div>
                      <div className="text-xl font-semibold">{metrics.avg_walk_m_per_day.toFixed(0)} m</div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted">
                      <div className="text-muted-foreground">Avg drive / day</div>
                      <div className="text-xl font-semibold">{metrics.avg_drive_m_per_day.toFixed(0)} m</div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted">
                      <div className="text-muted-foreground">Total CO₂ / day</div>
                      <div className="text-xl font-semibold">{metrics.total_emissions_kg_per_day.toFixed(2)} kg</div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted">
                        <div className="text-muted-foreground">Travel in (workers)</div>
                        <div className="text-xl font-semibold">{metrics.travel_in}</div>
                    </div>
        

                  </div>
                ) : (
                  <p className="text-muted-foreground">Run the simulation to see results.</p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border text-card-foreground">
              <CardHeader>
                <CardTitle>Visualization</CardTitle>
              </CardHeader>
              <CardContent>
                {metrics ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <XAxis dataKey="metric" tick={{ fill: "var(--muted-foreground)" }} interval={0} angle={-10} textAnchor="end" height={50} />
                        <YAxis tick={{ fill: "var(--muted-foreground)" }} />
                        <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)" }} labelStyle={{ color: "var(--foreground)" }} />
                        <Bar dataKey="value" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Results will appear here as a chart.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

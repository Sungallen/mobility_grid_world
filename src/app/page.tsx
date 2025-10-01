"use client";

export default function Page() {
  // If you see hydration warnings during dev, you can wrap in a client component by adding:
  // "use client";
  // at the top of this file or keep Page server and mark the component as client.
  return (
    <div className="min-h-screen">
      {/* If Page is server, mark the component file as `"use client";` at its top */}
      {/* or convert this Page into a client component by adding "use client"; */}
      {/* The component already uses client-only hooks, so either approach works. */}
      <ClientWrapper />
    </div>
  );
}

// --- Put this in the same file for simplicity, or import from a separate file ---
import MobilityGridWorldUI from "../components/ui/MobilityGridWorldUI";
function ClientWrapper() {
  return <MobilityGridWorldUI />;
}

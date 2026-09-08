import { useState } from "react";
import { Camera, RefreshCw, DoorOpen, Users, PenLine } from "lucide-react";

const FLOORS = [
  {
    id: "ground",
    label: "Ground Floor",
    zones: [
      { name: "Main / Central Lobby", capacity: 100, camera: false },
      { name: "Digispace", capacity: 150, camera: true },
    ],
  },
  {
    id: "first",
    label: "1st Floor",
    zones: [
      { name: "Main Area", capacity: 150, camera: false },
      { name: "Near Washroom / Staircase", capacity: 10, camera: false },
    ],
  },
  {
    id: "second",
    label: "2nd Floor",
    zones: [
      { name: "Near Staircase Area", capacity: 10, camera: false },
      { name: "Middle / Near GD Rooms", capacity: 10, camera: false },
      { name: "Near Washroom Area", capacity: 10, camera: false },
    ],
  },
  {
    id: "third",
    label: "3rd Floor",
    zones: [
      { name: "Near Washroom", capacity: 10, camera: false },
      { name: "Central Area", capacity: 30, camera: true },
      { name: "Parallel to Glass Wall", capacity: 80, camera: false },
    ],
  },
  {
    id: "fourth",
    label: "4th Floor \u2014 Quiet Study Zone",
    zones: [
      { name: "Near Washroom / Staircase Wall", capacity: 10, camera: false },
      { name: "Centre (Quiet Core)", capacity: 170, camera: true },
    ],
  },
];

function randomOccupied(capacity) {
  const min = Math.round(capacity * 0.35);
  const max = Math.round(capacity * 0.92);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function seedOccupancy() {
  const state = {};
  FLOORS.forEach((floor) => {
    floor.zones.forEach((zone) => {
      state[floor.id + "::" + zone.name] = randomOccupied(zone.capacity);
    });
  });
  return state;
}

const rotations = ["rotate-1", "-rotate-1", "rotate-2", "-rotate-2", "rotate-1"];

export default function LibrarySeatSketch() {
  const [activeFloor, setActiveFloor] = useState(FLOORS[0].id);
  const [occupancy, setOccupancy] = useState(seedOccupancy);
  const [pulse, setPulse] = useState(false);

  const floor = FLOORS.find((f) => f.id === activeFloor);

  function simulate() {
    setPulse(true);
    setOccupancy(seedOccupancy());
    setTimeout(() => setPulse(false), 400);
  }

  const floorTotalCapacity = floor.zones.reduce((s, z) => s + z.capacity, 0);
  const floorTotalOccupied = floor.zones.reduce(
    (s, z) => s + occupancy[floor.id + "::" + z.name],
    0
  );
  const floorAvailable = floorTotalCapacity - floorTotalOccupied;

  return (
    <div className="min-h-screen bg-stone-50 font-mono p-4 md:p-10">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div className="-rotate-1">
            <div className="flex items-center gap-2 mb-1">
              <PenLine className="w-5 h-5 text-stone-500" />
              <span className="text-xs uppercase tracking-widest text-stone-500">
                Rough sketch &middot; v0.1
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-stone-800 underline decoration-dashed decoration-2 underline-offset-8">
              Thapar Library Seat Availability
            </h1>
            <p className="text-sm text-stone-500 mt-2 max-w-md">
              Zone-based live availability. Individual seats are not numbered
              &mdash; students see how many seats are open per area, not which
              exact chair.
            </p>
          </div>
          <div className="border-2 border-dashed border-red-500 text-red-600 rounded-full px-4 py-2 rotate-6 text-xs font-bold uppercase tracking-wider shrink-0">
            Draft &middot; not final
          </div>
        </div>

        {/* Floor tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {FLOORS.map((f, i) => (
            <button
              key={f.id}
              onClick={() => setActiveFloor(f.id)}
              className={
                "border-2 border-dashed px-4 py-2 text-sm font-bold transition-transform " +
                (rotations[i % rotations.length]) +
                " " +
                (activeFloor === f.id
                  ? "bg-stone-800 text-stone-50 border-stone-800"
                  : "bg-white text-stone-700 border-stone-400 hover:border-stone-700")
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Floor summary + simulate button */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-2 border-dashed border-stone-400 bg-white/70 rounded-lg px-4 py-3 rotate-1">
          <div className="flex items-center gap-2 text-stone-700">
            <Users className="w-4 h-4" />
            <span className="text-sm">
              <span className="font-bold">{floorAvailable}</span> available of{" "}
              {floorTotalCapacity} seats on {floor.label}
            </span>
          </div>
          <button
            onClick={simulate}
            className="flex items-center gap-2 border-2 border-dashed border-stone-600 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded text-xs font-bold text-stone-700"
          >
            <RefreshCw className={"w-3.5 h-3.5 " + (pulse ? "animate-spin" : "")} />
            Simulate live update
          </button>
        </div>

        {/* Zone cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
          {floor.zones.map((zone, i) => {
            const occ = occupancy[floor.id + "::" + zone.name];
            const avail = zone.capacity - occ;
            const pct = Math.round((occ / zone.capacity) * 100);
            return (
              <div
                key={zone.name}
                className={
                  "border-2 border-dashed border-stone-500 bg-white rounded-lg p-4 " +
                  rotations[i % rotations.length]
                }
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-bold text-stone-800">{zone.name}</p>
                    <p className="text-xs text-stone-500">
                      Capacity ~{zone.capacity} seats
                    </p>
                  </div>
                  {zone.camera && (
                    <div className="flex items-center gap-1 border border-dashed border-blue-500 bg-blue-50 text-blue-700 text-xs font-bold px-2 py-1 rounded rotate-3">
                      <Camera className="w-3 h-3" />
                      Pilot cam
                    </div>
                  )}
                </div>

                <div className="border-2 border-stone-700 rounded-full h-4 overflow-hidden bg-stone-100 mb-2">
                  <div
                    className="h-full bg-stone-700 transition-all duration-300"
                    style={{ width: pct + "%" }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-stone-600">
                  <span>
                    <span className="font-bold text-stone-800">{avail}</span> available
                  </span>
                  <span>{occ} occupied</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Annotation sticky note */}
        <div className="border-2 border-dashed border-amber-500 bg-amber-100 rounded-lg p-4 max-w-sm rotate-2 mb-8 shadow-sm">
          <p className="text-xs font-bold text-amber-800 mb-1 flex items-center gap-1">
            <PenLine className="w-3 h-3" /> note to self
          </p>
          <p className="text-xs text-amber-900 leading-relaxed">
            Pilot cam zones run YOLO to detect chairs with a marked region.
            If a chair shows no person for 30 continuous minutes &rarr; auto
            freed &amp; available count updates. Rest of campus stays
            manual/gate-based for now.
          </p>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-stone-500 border-t-2 border-dashed border-stone-300 pt-4">
          <span className="flex items-center gap-1">
            <Camera className="w-3.5 h-3.5" /> Pilot camera zone (Phase 1)
          </span>
          <span className="flex items-center gap-1">
            <DoorOpen className="w-3.5 h-3.5" /> All other zones: manual gate log for now
          </span>
          <span>Capacities are estimates, pending physical seat count</span>
        </div>
      </div>
    </div>
  );
}
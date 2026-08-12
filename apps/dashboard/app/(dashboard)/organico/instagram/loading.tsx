export default function Loading() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-20 rounded-xl bg-[#111827] border border-[#1F2937]" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-[#111827] border border-[#1F2937]" />
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-64 rounded-xl bg-[#111827] border border-[#1F2937]" />
        ))}
      </div>
      <div className="h-80 rounded-xl bg-[#111827] border border-[#1F2937]" />
    </div>
  )
}

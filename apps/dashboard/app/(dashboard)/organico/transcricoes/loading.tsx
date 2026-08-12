export default function Loading() {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="h-8 w-48 rounded-lg bg-[#111827] border border-[#1F2937] animate-pulse" />
      <div className="h-28 rounded-xl bg-[#111827] border border-[#1F2937] animate-pulse" />
      <div className="h-6 w-32 rounded bg-[#111827] border border-[#1F2937] animate-pulse" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-24 rounded-xl bg-[#111827] border border-[#1F2937] animate-pulse" />
      ))}
    </div>
  )
}

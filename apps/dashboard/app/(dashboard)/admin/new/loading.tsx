export default function Loading() {
  return (
    <div className="p-6 max-w-xl space-y-4">
      <div className="h-7 w-48 rounded-lg bg-[#111827] border border-[#1F2937] animate-pulse" />
      <div className="h-4 w-72 rounded bg-[#111827] border border-[#1F2937] animate-pulse" />
      <div className="space-y-3 pt-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded-lg bg-[#111827] border border-[#1F2937] animate-pulse" />
        ))}
      </div>
      <div className="h-10 w-32 rounded-lg bg-[#111827] border border-[#1F2937] animate-pulse" />
    </div>
  )
}

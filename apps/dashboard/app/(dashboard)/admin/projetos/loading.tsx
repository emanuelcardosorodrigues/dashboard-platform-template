export default function Loading() {
  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div className="h-7 w-52 rounded-lg bg-[#111827] border border-[#1F2937] animate-pulse" />
      <div className="h-4 w-80 rounded bg-[#111827] border border-[#1F2937] animate-pulse" />
      <div className="space-y-2 pt-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-[#111827] border border-[#1F2937] animate-pulse" />
        ))}
      </div>
    </div>
  )
}

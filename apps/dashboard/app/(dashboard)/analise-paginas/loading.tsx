export default function Loading() {
  return (
    <div className="flex-1 p-6 space-y-6">
      <div className="h-14 bg-[#111827] border border-[#1F2937] rounded-xl animate-pulse" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 bg-[#111827] border border-[#1F2937] rounded-xl animate-pulse" />
        ))}
      </div>
      <div className="h-96 bg-[#111827] border border-[#1F2937] rounded-xl animate-pulse" />
    </div>
  )
}

export default function Loading() {
  return (
    <div className="flex-1 p-6 space-y-4">
      <div className="h-10 bg-[#111827] border border-[#1F2937] rounded-xl animate-pulse w-40 ml-auto" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 bg-[#111827] border border-[#1F2937] rounded-xl animate-pulse" />
        ))}
      </div>
    </div>
  )
}

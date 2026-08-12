export default function Loading() {
  return (
    <div className="flex-1 p-6 space-y-6">
      <div className="h-14 bg-[#111827] border border-[#1F2937] rounded-xl animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="h-40 bg-[#111827] border border-[#1F2937] rounded-xl animate-pulse" />
        <div className="h-40 bg-[#111827] border border-[#1F2937] rounded-xl animate-pulse" />
      </div>
      <div className="h-80 bg-[#111827] border border-[#1F2937] rounded-xl animate-pulse" />
    </div>
  )
}

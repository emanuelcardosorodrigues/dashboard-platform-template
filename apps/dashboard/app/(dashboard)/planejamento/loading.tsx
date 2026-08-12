export default function Loading() {
  return (
    <div className="flex flex-col h-full">
      <div className="h-16 border-b border-[#1F2937] px-6 flex items-center">
        <div className="h-5 w-72 bg-[#1F2937] rounded animate-pulse" />
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
              <div className="h-24 bg-[#1F2937] animate-pulse" />
              <div className="p-4 space-y-3">
                <div className="h-4 w-2/3 bg-[#1F2937] rounded animate-pulse" />
                <div className="h-3 w-1/3 bg-[#1F2937] rounded animate-pulse" />
                <div className="grid grid-cols-3 gap-2 pt-2">
                  {Array.from({ length: 3 }).map((_, j) => <div key={j} className="h-8 bg-[#1F2937] rounded animate-pulse" />)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

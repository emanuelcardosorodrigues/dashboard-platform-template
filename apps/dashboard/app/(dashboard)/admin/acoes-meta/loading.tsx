export default function Loading() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-16 bg-[#0A0F1E] border-b border-[#1F2937] flex items-center px-6 shrink-0">
        <div className="h-5 w-52 rounded bg-[#1F2937] animate-pulse" />
      </div>
      {/* Tabela */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="rounded-xl bg-[#111827] border border-[#1F2937] overflow-hidden">
          <div className="h-10 bg-[#0A0F1E] border-b border-[#1F2937] animate-pulse" />
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-12 border-b border-[#1F2937] last:border-b-0 animate-pulse bg-[#111827]" />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Loading() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-16 bg-[#0A0F1E] border-b border-[#1F2937] flex items-center px-6 shrink-0">
        <div className="h-5 w-40 rounded bg-[#1F2937] animate-pulse" />
      </div>
      {/* Formulário */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-2xl">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-[#111827] border border-[#1F2937] animate-pulse" />
        ))}
        <div className="h-10 w-36 rounded-lg bg-[#111827] border border-[#1F2937] animate-pulse" />
      </div>
    </div>
  )
}

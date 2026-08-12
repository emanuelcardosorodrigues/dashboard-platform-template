export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <div className="w-full max-w-sm space-y-4">
        <div className="h-8 w-40 mx-auto rounded-lg bg-[#111827] border border-[#1F2937] animate-pulse" />
        <div className="h-10 rounded-lg bg-[#111827] border border-[#1F2937] animate-pulse" />
        <div className="h-10 rounded-lg bg-[#111827] border border-[#1F2937] animate-pulse" />
      </div>
    </div>
  )
}

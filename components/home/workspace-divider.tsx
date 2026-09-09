export function WorkspaceDivider() {
  return (
    <div className="mb-9 flex flex-col items-center text-center sm:mb-11">
      <svg
        aria-hidden="true"
        viewBox="0 0 72 92"
        className="h-16 w-14 text-slate-600 sm:h-[76px] sm:w-16"
        fill="none"
      >
        <path
          d="M27 4c11 18 13 37 5 51-4 7-11 11-18 8-5-2-7-7-4-11 4-6 13-3 18 3 7 9 7 20 2 29"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M20 74l10 12 10-13"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <h2 className="mt-2 text-2xl font-black tracking-[-0.035em] text-white sm:text-3xl">
        Chọn Workspace để xem chi tiết
      </h2>
    </div>
  )
}

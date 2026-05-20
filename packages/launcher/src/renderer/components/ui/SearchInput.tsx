import * as React from "react"
import { Search, X } from "lucide-react"
import { cn } from "../../lib/utils"

export interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onClear?: () => void
}

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, value, onClear, onChange, ...props }, ref) => (
    <div className={cn("relative flex items-center", className)}>
      <Search className="absolute left-2.5 h-3.5 w-3.5 text-(--text-tertiary) pointer-events-none" strokeWidth={2} />
      <input
        ref={ref} type="text" value={value} onChange={onChange}
        className="w-full rounded-sm py-[7px] pl-8 pr-8 text-[12px] bg-(--bg-input) text-(--text-primary) border border-transparent outline-none placeholder:text-(--text-tertiary) focus:border-(--accent-border) focus:bg-(--bg-secondary) transition-all duration-150"
        {...props}
      />
      {value && onClear && (
        <button type="button" onClick={onClear} className="absolute right-2.5 flex items-center justify-center text-(--text-tertiary) hover:text-(--text-primary) transition-colors">
          <X strokeWidth={2} className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  ),
)
SearchInput.displayName = "SearchInput"

export { SearchInput }

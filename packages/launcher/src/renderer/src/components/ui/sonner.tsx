import React from "react"
import { Toaster as Sonner, toast } from "sonner"

export { toast }

export function Toaster(): React.JSX.Element {
  return (
    <Sonner
      position="top-right"
      gap={8}
      toastOptions={{ duration: 4000 }}
    />
  )
}

import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"
import { ModalPresentationContext, modalSemanticIcon } from '@/contexts/ModalPresentationContext';

const labelVariants = cva(
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
)

const Label = React.forwardRef(({ className, children, ...props }, ref) => {
  const modal = React.useContext(ModalPresentationContext);
  return <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), modal && 'leading-relaxed', className)} {...props}>{modal && modalSemanticIcon(children)}{children}</LabelPrimitive.Root>;
})
Label.displayName = LabelPrimitive.Root.displayName

export { Label }

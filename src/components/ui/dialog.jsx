import {ModalPresentationContext,modalAction} from '@/contexts/ModalPresentationContext'
import { phonePortal } from '@/contexts/PhoneAppContext'
import { withServiceSuspension } from '@/contexts/ServiceSuspensionContext'
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = withServiceSuspension(DialogPrimitive.Root)

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = phonePortal(DialogPrimitive.Portal)

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-0 pointer-events-auto bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef(({ className, children, plain = false, overlayClassName, hideClose = false, ...props }, ref) => (
  <DialogPortal>
    <div data-modal-layer className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-10 pointer-events-auto grid max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg gap-4 overflow-y-auto rounded-lg border p-5 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:w-full sm:p-6",
        !plain && "glass-effect",
        className
      )}
      {...props}>
      <ModalPresentationContext.Provider value={true}>{children}</ModalPresentationContext.Provider>
      {!hideClose && <DialogPrimitive.Close
        aria-label="Fechar"
        className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Fechar</span>
      </DialogPrimitive.Close>}
    </DialogPrimitive.Content>
    </div>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn(className,"flex flex-col items-center space-y-1.5 text-center sm:text-center")}
    {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn(className,"flex flex-col-reverse sm:flex-row items-center justify-center sm:justify-center gap-2")}
    {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}

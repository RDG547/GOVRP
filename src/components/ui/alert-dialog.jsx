import {ModalPresentationContext,modalAction} from '@/contexts/ModalPresentationContext'
import { phonePortal } from '@/contexts/PhoneAppContext'
import { withServiceSuspension } from '@/contexts/ServiceSuspensionContext'
import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

const AlertDialog = withServiceSuspension(AlertDialogPrimitive.Root)

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = phonePortal(AlertDialogPrimitive.Portal)

const AlertDialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-0 pointer-events-auto bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref} />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <div data-modal-layer className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
    <AlertDialogOverlay />
    <ModalPresentationContext.Provider value={true}><AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-10 pointer-events-auto grid max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg gap-4 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:w-full sm:p-6",
        "glass-effect border-white/10 text-white",
        className
      )}
      {...props} /></ModalPresentationContext.Provider>
    </div>
  </AlertDialogPortal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn(className,"flex flex-col items-center space-y-2 text-center sm:text-center")}
    {...props} />
)
AlertDialogHeader.displayName = "AlertDialogHeader"

const AlertDialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn(className,"flex flex-col-reverse sm:flex-row items-center justify-center sm:justify-center gap-2")}
    {...props} />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

const AlertDialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", "text-gray-400", className)}
    {...props} />
))
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef(({ className, children, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants({variant:modalAction(children).variant}), className)} {...props}>{modalAction(children).icon}{children}</AlertDialogPrimitive.Action>
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef(({ className, children, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: "outline" }), "mt-2 sm:mt-0", className)}
    {...props}>{modalAction(children).icon}{children}</AlertDialogPrimitive.Cancel>
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}

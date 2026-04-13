/**
 * Skeleton — Loading placeholder components
 */

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div className={`animate-pulse bg-slate-700/50 rounded-lg ${className}`} />
  )
}

/** Skeleton for an event type card */
export function EventTypeCardSkeleton() {
  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
      <div className="h-2 bg-slate-700/50 animate-pulse" />
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="w-11 h-6 rounded-full" />
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
    </div>
  )
}

/** Skeleton for a meeting card */
export function MeetingCardSkeleton() {
  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="flex flex-col gap-1 items-end">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-16" />
      </div>
    </div>
  )
}

/** Skeleton for availability day row */
export function AvailabilityRowSkeleton() {
  return (
    <div className="p-4 flex items-center gap-4">
      <Skeleton className="w-11 h-6 rounded-full" />
      <Skeleton className="h-5 w-24" />
      <div className="flex items-center gap-3 flex-1">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-9 w-28" />
      </div>
    </div>
  )
}

/** Skeleton for the dashboard upcoming meeting row */
export function DashboardMeetingSkeleton() {
  return (
    <div className="bg-slate-800/60 rounded-xl border border-slate-700/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="w-12 h-12 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="space-y-2 text-right">
          <Skeleton className="h-4 w-28 ml-auto" />
          <Skeleton className="h-4 w-24 ml-auto" />
        </div>
      </div>
    </div>
  )
}

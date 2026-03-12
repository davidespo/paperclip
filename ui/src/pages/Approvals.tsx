import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useLocation } from "@/lib/router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { accessApi } from "../api/access";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { PageTabBar } from "../components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Identity } from "../components/Identity";
import { StatusBadge } from "../components/StatusBadge";
import { ApprovalPayloadRenderer, typeLabel as approvalTypeLabel } from "../components/ApprovalPayload";
import { PageSkeleton } from "../components/PageSkeleton";
import { timeAgo } from "../lib/timeAgo";
import { ArrowUpRight, CheckCircle2, Clock3, ShieldCheck, UserPlus2 } from "lucide-react";
import type { ActiveRunForIssue } from "../api/heartbeats";
import type { Agent, Approval, Issue, JoinRequest } from "@paperclipai/shared";

type StatusFilter = "pending" | "all";

function getApprovalFollowUp(copy: Approval, linkedIssues: Issue[], activeRun: ActiveRunForIssue | null): string {
  if (copy.status === "approved") {
    if (activeRun) return "Approved. The linked work is already executing.";
    if (linkedIssues.length > 0) return "Approved. Follow through on the linked issue to confirm the requester completed the next step.";
    return "Approved. The requester can continue from the approval detail.";
  }
  if (copy.status === "rejected") {
    return "Rejected. The requester will need to revise the request or submit a new one.";
  }
  if (copy.status === "revision_requested") {
    return "Revision requested. Review the updated packet or leave a note in the detail view before approving.";
  }
  if (activeRun) {
    return "Approve to let the current work continue with board backing. Reject to stop the request and force a new plan.";
  }
  return "Approve to unlock the request and notify the requester. Reject to stop this path while preserving the audit trail.";
}

function ReviewQueueApprovalCard({
  approval,
  requesterAgent,
  linkedIssues,
  activeRun,
  onApprove,
  onReject,
  isPending,
}: {
  approval: Approval;
  requesterAgent: Agent | null;
  linkedIssues: Issue[];
  activeRun: ActiveRunForIssue | null;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
}) {
  const isActionable = approval.status === "pending" || approval.status === "revision_requested";
  const followUp = getApprovalFollowUp(approval, linkedIssues, activeRun);

  return (
    <article className="rounded-2xl border border-border bg-card/90 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Decision Packet
            </span>
            <StatusBadge status={approval.status} />
            <span className="text-xs text-muted-foreground">Requested {timeAgo(approval.createdAt)}</span>
          </div>

          <div>
            <h3 className="text-lg font-semibold">
              {approvalTypeLabel[approval.type] ?? approval.type.replace(/_/g, " ")}
            </h3>
            {requesterAgent ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <span>Requested by</span>
                <Identity name={requesterAgent.name} size="sm" />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isActionable ? (
            <>
              <Button
                size="sm"
                className="bg-green-700 text-white hover:bg-green-600"
                onClick={onApprove}
                disabled={isPending}
              >
                Approve
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={onReject}
                disabled={isPending}
              >
                Reject
              </Button>
            </>
          ) : null}
          <Button variant="outline" size="sm" asChild>
            <Link to={`/approvals/${approval.id}`}>
              Open approval
              <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <section className="rounded-xl border border-border/70 bg-background/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Request
          </p>
          <ApprovalPayloadRenderer type={approval.type} payload={approval.payload} />
        </section>

        <section className="rounded-xl border border-border/70 bg-background/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Source Context
          </p>

          <div className="mt-3 space-y-3">
            {linkedIssues.length > 0 ? (
              <div className="space-y-2">
                {linkedIssues.map((issue) => (
                  <Link
                    key={issue.id}
                    to={`/issues/${issue.identifier ?? issue.id}`}
                    className="block rounded-lg border border-border px-3 py-2 text-inherit no-underline transition-colors hover:bg-accent/40"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{issue.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {issue.identifier ?? issue.id.slice(0, 8)}
                        </p>
                      </div>
                      <StatusBadge status={issue.status} />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No linked issues on this approval.</p>
            )}

            {activeRun ? (
              <Link
                to={`/agents/${activeRun.agentId}/runs/${activeRun.id}`}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-inherit no-underline transition-colors hover:bg-accent/40"
              >
                <div>
                  <p className="text-sm font-medium">Current run</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {activeRun.agentName} started {timeAgo(activeRun.createdAt)}
                  </p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ) : linkedIssues.length > 0 ? (
              <p className="text-sm text-muted-foreground">No active run is attached to the linked issue right now.</p>
            ) : null}
          </div>
        </section>
      </div>

      <div className="mt-4 rounded-xl border border-border/70 bg-muted/30 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Next Step
        </p>
        <p className="mt-2 text-sm text-foreground">{followUp}</p>
      </div>
    </article>
  );
}

function JoinRequestCard({
  joinRequest,
  onApprove,
  onReject,
  isPending,
}: {
  joinRequest: JoinRequest;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
}) {
  return (
    <article className="rounded-2xl border border-border bg-card/90 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
              Access Decision
            </span>
            <StatusBadge status={joinRequest.status} />
            <span className="text-xs text-muted-foreground">Requested {timeAgo(joinRequest.createdAt)}</span>
          </div>

          <div>
            <h3 className="text-lg font-semibold">
              {joinRequest.requestType === "human"
                ? "Human join request"
                : `Agent join request${joinRequest.agentName ? `: ${joinRequest.agentName}` : ""}`}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {joinRequest.requestType === "human"
                ? "Approve to grant board access. Reject to deny access without changing company state."
                : "Approve to onboard this agent into the company. Reject to deny the request and keep the adapter outside the org."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onReject} disabled={isPending}>
            Reject
          </Button>
          <Button size="sm" onClick={onApprove} disabled={isPending}>
            Approve
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <section className="rounded-xl border border-border/70 bg-background/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Request
          </p>
          <div className="mt-3 space-y-2 text-sm">
            {joinRequest.requestEmailSnapshot ? (
              <p><span className="text-muted-foreground">Email:</span> {joinRequest.requestEmailSnapshot}</p>
            ) : null}
            {joinRequest.adapterType ? (
              <p><span className="text-muted-foreground">Adapter:</span> {joinRequest.adapterType}</p>
            ) : null}
            {joinRequest.agentName ? (
              <p><span className="text-muted-foreground">Agent:</span> {joinRequest.agentName}</p>
            ) : null}
            {joinRequest.capabilities ? (
              <p className="text-muted-foreground">{joinRequest.capabilities}</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-border/70 bg-background/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Decision Effect
          </p>
          <p className="mt-3 text-sm text-foreground">
            Approval immediately advances onboarding. Rejection closes the request with no company-side follow-up work.
          </p>
        </section>
      </div>
    </article>
  );
}

export function Approvals() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const pathSegment = location.pathname.split("/").pop() ?? "pending";
  const statusFilter: StatusFilter = pathSegment === "all" ? "all" : "pending";
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Review Queue" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: joinRequests = [] } = useQuery({
    queryKey: queryKeys.access.joinRequests(selectedCompanyId!),
    queryFn: () => accessApi.listJoinRequests(selectedCompanyId!, "pending_approval"),
    enabled: !!selectedCompanyId && statusFilter === "pending",
    retry: false,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.approve(id),
    onSuccess: (_approval, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
      navigate(`/approvals/${id}?resolved=approved`);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.reject(id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject");
    },
  });

  const approveJoinMutation = useMutation({
    mutationFn: (joinRequest: JoinRequest) =>
      accessApi.approveJoinRequest(selectedCompanyId!, joinRequest.id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.access.joinRequests(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve join request");
    },
  });

  const rejectJoinMutation = useMutation({
    mutationFn: (joinRequest: JoinRequest) =>
      accessApi.rejectJoinRequest(selectedCompanyId!, joinRequest.id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.access.joinRequests(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject join request");
    },
  });

  const filtered = (data ?? [])
    .filter(
      (a) => statusFilter === "all" || a.status === "pending" || a.status === "revision_requested",
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const pendingCount = (data ?? []).filter(
    (a) => a.status === "pending" || a.status === "revision_requested",
  ).length;
  const approvalIssueQueries = useQueries({
    queries: filtered.map((approval) => ({
      queryKey: queryKeys.approvals.issues(approval.id),
      queryFn: () => approvalsApi.listIssues(approval.id),
      enabled: !!selectedCompanyId,
    })),
  });
  const primaryIssueIds = useMemo(
    () => approvalIssueQueries.map((query) => query.data?.[0]?.id ?? null),
    [approvalIssueQueries],
  );
  const activeRunQueries = useQueries({
    queries: primaryIssueIds
      .map((issueId) =>
        issueId
          ? {
              queryKey: queryKeys.issues.activeRun(issueId),
              queryFn: () => heartbeatsApi.activeRunForIssue(issueId),
              enabled: !!selectedCompanyId,
            }
          : null,
      )
      .filter((query): query is NonNullable<typeof query> => query !== null),
  });
  const linkedIssuesByApprovalId = useMemo(() => {
    const map = new Map<string, Issue[]>();
    filtered.forEach((approval, index) => {
      map.set(approval.id, approvalIssueQueries[index]?.data ?? []);
    });
    return map;
  }, [approvalIssueQueries, filtered]);
  const activeRunByApprovalId = useMemo(() => {
    const map = new Map<string, ActiveRunForIssue | null>();
    let runIndex = 0;
    filtered.forEach((approval, index) => {
      if (primaryIssueIds[index]) {
        map.set(approval.id, activeRunQueries[runIndex]?.data ?? null);
        runIndex += 1;
      } else {
        map.set(approval.id, null);
      }
    });
    return map;
  }, [activeRunQueries, filtered, primaryIssueIds]);
  const decisionCount = pendingCount + joinRequests.length;

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }

  if (isLoading) {
    return <PageSkeleton variant="approvals" />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card/80 p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Review Queue
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {statusFilter === "pending" ? "Decisions waiting on the board" : "Approval history"}
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Work through human decisions from one surface, with enough issue and run context to act without thread-diving.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border/70 bg-background/60 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Waiting</p>
              <p className="mt-2 text-2xl font-semibold">{decisionCount}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Approvals</p>
              <p className="mt-2 text-2xl font-semibold">{pendingCount}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Access</p>
              <p className="mt-2 text-2xl font-semibold">{joinRequests.length}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Resolved</p>
              <p className="mt-2 text-2xl font-semibold">{(data ?? []).length - pendingCount}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between">
        <Tabs value={statusFilter} onValueChange={(v) => navigate(`/approvals/${v}`)}>
          <PageTabBar items={[
            { value: "pending", label: <>Needs Decision{decisionCount > 0 && (
              <span className={cn(
                "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                "bg-yellow-500/20 text-yellow-500"
              )}>
                {decisionCount}
              </span>
            )}</> },
            { value: "all", label: "Approval History" },
          ]} />
        </Tabs>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {statusFilter === "pending" && joinRequests.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <UserPlus2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Access Decisions
            </h2>
          </div>
          <div className="grid gap-4">
            {joinRequests.map((joinRequest) => (
              <JoinRequestCard
                key={joinRequest.id}
                joinRequest={joinRequest}
                onApprove={() => approveJoinMutation.mutate(joinRequest)}
                onReject={() => rejectJoinMutation.mutate(joinRequest)}
                isPending={approveJoinMutation.isPending || rejectJoinMutation.isPending}
              />
            ))}
          </div>
        </section>
      )}

      {filtered.length === 0 && joinRequests.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            {statusFilter === "pending" ? "No review decisions are waiting." : "No approvals yet."}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            {statusFilter === "pending" ? (
              <Clock3 className="h-4 w-4 text-muted-foreground" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            )}
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {statusFilter === "pending" ? "Approval Decisions" : "Resolved Approvals"}
            </h2>
          </div>

          {statusFilter === "all" && (
            <p className="text-sm text-muted-foreground">
              Review the decision trail, then jump back into the source approval or linked issue when you need detail.
            </p>
          )}

          <div className="grid gap-4">
          {filtered.map((approval) => (
            <ReviewQueueApprovalCard
              key={approval.id}
              approval={approval}
              requesterAgent={approval.requestedByAgentId ? (agents ?? []).find((a) => a.id === approval.requestedByAgentId) ?? null : null}
              linkedIssues={linkedIssuesByApprovalId.get(approval.id) ?? []}
              activeRun={activeRunByApprovalId.get(approval.id) ?? null}
              onApprove={() => approveMutation.mutate(approval.id)}
              onReject={() => rejectMutation.mutate(approval.id)}
              isPending={approveMutation.isPending || rejectMutation.isPending}
            />
          ))}
          </div>
        </section>
      )}
    </div>
  );
}

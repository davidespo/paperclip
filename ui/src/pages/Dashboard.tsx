import { useEffect, useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard";
import { approvalsApi } from "../api/approvals";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { heartbeatsApi } from "../api/heartbeats";
import { goalsApi } from "../api/goals";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { PriorityIcon } from "../components/PriorityIcon";
import { Identity } from "../components/Identity";
import { StatusBadge } from "../components/StatusBadge";
import { timeAgo } from "../lib/timeAgo";
import { formatCents, issueUrl, projectUrl } from "../lib/utils";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDot,
  DollarSign,
  FolderKanban,
  LayoutDashboard,
  PlayCircle,
  ShieldCheck,
  Target,
} from "lucide-react";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { PageSkeleton } from "../components/PageSkeleton";
import type { Agent, Approval, Goal, HeartbeatRun, Issue, Project } from "@paperclipai/shared";
import { typeLabel as approvalTypeLabel } from "../components/ApprovalPayload";

function getCompanyGoal(goals: Goal[]) {
  return (
    goals.find((goal) => goal.level === "company" && goal.status === "active")
    ?? goals.find((goal) => goal.level === "company")
    ?? goals[0]
    ?? null
  );
}

function getBlockedIssues(issues: Issue[]) {
  const priorityWeight: Record<Issue["priority"], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  return issues
    .filter((issue) => issue.status === "blocked")
    .sort((a, b) => {
      const priorityDiff = priorityWeight[b.priority] - priorityWeight[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .slice(0, 4);
}

function getPendingApprovals(approvals: Approval[]) {
  return approvals
    .filter((approval) => approval.status === "pending" || approval.status === "revision_requested")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);
}

function getRecentOutcomes(issues: Issue[]) {
  return issues
    .filter((issue) => issue.status === "done")
    .sort((a, b) => {
      const bTime = new Date(b.completedAt ?? b.updatedAt).getTime();
      const aTime = new Date(a.completedAt ?? a.updatedAt).getTime();
      return bTime - aTime;
    })
    .slice(0, 5);
}

function getActiveIssues(issues: Issue[]) {
  const priorityWeight: Record<Issue["priority"], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  return issues
    .filter((issue) => issue.status === "in_progress" || issue.status === "todo")
    .sort((a, b) => {
      const statusWeight = (b.status === "in_progress" ? 1 : 0) - (a.status === "in_progress" ? 1 : 0);
      if (statusWeight !== 0) return statusWeight;
      const priorityDiff = priorityWeight[b.priority] - priorityWeight[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .slice(0, 6);
}

function getProjectSnapshots(projects: Project[], issues: Issue[]) {
  return projects
    .map((project) => {
      const projectIssues = issues.filter((issue) => issue.projectId === project.id);
      const active = projectIssues.filter((issue) => issue.status === "in_progress").length;
      const blocked = projectIssues.filter((issue) => issue.status === "blocked").length;
      const todo = projectIssues.filter((issue) => issue.status === "todo").length;
      const done = projectIssues.filter((issue) => issue.status === "done").length;
      const focusIssue =
        projectIssues.find((issue) => issue.status === "in_progress")
        ?? projectIssues.find((issue) => issue.status === "blocked")
        ?? projectIssues.find((issue) => issue.status === "todo")
        ?? null;

      return {
        project,
        active,
        blocked,
        todo,
        done,
        focusIssue,
        score: active * 100 + blocked * 10 + todo,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.project.updatedAt).getTime() - new Date(a.project.updatedAt).getTime();
    })
    .slice(0, 4);
}

function getRecentRunAlerts(runs: HeartbeatRun[], agents: Agent[]) {
  const agentNameById = new Map(agents.map((agent) => [agent.id, agent.name]));
  const latestRunByScope = new Map<string, HeartbeatRun>();

  for (const run of runs) {
    const issueId =
      typeof run.contextSnapshot?.issueId === "string"
        ? run.contextSnapshot.issueId
        : typeof run.contextSnapshot?.taskId === "string"
          ? run.contextSnapshot.taskId
          : null;
    const scopeKey = issueId ? `issue:${issueId}` : `agent:${run.agentId}`;
    const existing = latestRunByScope.get(scopeKey);
    const runTime = new Date(run.finishedAt ?? run.startedAt ?? run.createdAt).getTime();
    const existingTime = existing
      ? new Date(existing.finishedAt ?? existing.startedAt ?? existing.createdAt).getTime()
      : -1;

    if (!existing || runTime > existingTime) {
      latestRunByScope.set(scopeKey, run);
    }
  }

  return [...latestRunByScope.values()]
    .filter((run) => run.status === "failed" || run.status === "running" || run.status === "queued")
    .sort((a, b) => {
      const severity = (run: HeartbeatRun) => (run.status === "failed" ? 2 : 1);
      const severityDiff = severity(b) - severity(a);
      if (severityDiff !== 0) return severityDiff;
      const bTime = new Date(b.finishedAt ?? b.startedAt ?? b.createdAt).getTime();
      const aTime = new Date(a.finishedAt ?? a.startedAt ?? a.createdAt).getTime();
      return bTime - aTime;
    })
    .slice(0, 4)
    .map((run) => ({
      run,
      agentName: agentNameById.get(run.agentId) ?? "Unknown agent",
      issueId:
        typeof run.contextSnapshot?.issueId === "string"
          ? run.contextSnapshot.issueId
          : typeof run.contextSnapshot?.taskId === "string"
            ? run.contextSnapshot.taskId
            : null,
    }));
}

function describeCompanyStatus({
  runningAgents,
  tasksInProgress,
  blockedIssues,
  pendingApprovals,
}: {
  runningAgents: number;
  tasksInProgress: number;
  blockedIssues: number;
  pendingApprovals: number;
}) {
  if (blockedIssues > 0) {
    return `${blockedIssues} blocked ${blockedIssues === 1 ? "issue needs" : "issues need"} attention.`;
  }
  if (pendingApprovals > 0) {
    return `${pendingApprovals} pending ${pendingApprovals === 1 ? "approval is" : "approvals are"} waiting on review.`;
  }
  if (tasksInProgress > 0) {
    return `${tasksInProgress} ${tasksInProgress === 1 ? "task is" : "tasks are"} actively moving.`;
  }
  if (runningAgents > 0) {
    return `${runningAgents} ${runningAgents === 1 ? "agent is" : "agents are"} currently running.`;
  }
  return "No active company execution yet.";
}

export function Dashboard() {
  const { selectedCompanyId, selectedCompany, companies } = useCompany();
  const { openOnboarding } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Workboard" }]);
  }, [setBreadcrumbs]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: approvals } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: runs } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!, undefined, 20),
    enabled: !!selectedCompanyId,
  });

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const blockedIssues = useMemo(() => getBlockedIssues(issues ?? []), [issues]);
  const pendingApprovals = useMemo(() => getPendingApprovals(approvals ?? []), [approvals]);
  const recentOutcomes = useMemo(() => getRecentOutcomes(issues ?? []), [issues]);
  const activeIssues = useMemo(() => getActiveIssues(issues ?? []), [issues]);
  const projectSnapshots = useMemo(
    () => getProjectSnapshots(projects ?? [], issues ?? []),
    [projects, issues],
  );
  const recentRunAlerts = useMemo(
    () => getRecentRunAlerts(runs ?? [], agents ?? []),
    [runs, agents],
  );
  const companyGoal = useMemo(() => getCompanyGoal(goals ?? []), [goals]);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents ?? []) map.set(agent.id, agent);
    return map;
  }, [agents]);

  const issueMap = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues ?? []) map.set(issue.id, issue);
    return map;
  }, [issues]);

  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          message="Welcome to Paperclip. Set up your first company and agent to get started."
          action="Get Started"
          onAction={openOnboarding}
        />
      );
    }
    return (
      <EmptyState icon={LayoutDashboard} message="Create or select a company to view the workboard." />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const hasNoAgents = agents !== undefined && agents.length === 0;
  const companyStatusMessage = describeCompanyStatus({
    runningAgents: data?.agents.running ?? 0,
    tasksInProgress: data?.tasks.inProgress ?? 0,
    blockedIssues: blockedIssues.length,
    pendingApprovals: pendingApprovals.length,
  });

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {hasNoAgents && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/25 dark:bg-amber-950/60">
          <div className="flex items-center gap-2.5">
            <Bot className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-amber-900 dark:text-amber-100">
              You have no agents.
            </p>
          </div>
          <button
            onClick={() => openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })}
            className="shrink-0 text-sm font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
          >
            Create one here
          </button>
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card/80 p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              {selectedCompany?.name ?? "Company"} Workboard
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              {companyStatusMessage}
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Summary first: review what needs attention, see which work is actively moving, then drill into projects, issues, and live runs only where detail is needed.
            </p>
          </div>
          {companyGoal && (
            <Link
              to={`/goals/${companyGoal.id}`}
              className="block rounded-xl border border-border bg-background/70 p-4 text-inherit no-underline transition-colors hover:bg-accent/40 lg:max-w-sm"
            >
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Target className="h-3.5 w-3.5" />
                Current Goal
              </div>
              <p className="mt-3 text-base font-medium text-foreground">
                {companyGoal.title}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {data?.tasks.inProgress ?? 0} in progress, {data?.tasks.blocked ?? 0} blocked, {projects?.length ?? 0} projects in view
              </p>
            </Link>
          )}
        </div>
      </section>

      {data && (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={CircleDot}
            value={data.tasks.inProgress}
            label="Active Work"
            to="/issues"
            description={<span>{data.tasks.open} open tasks across the company</span>}
          />
          <MetricCard
            icon={AlertTriangle}
            value={blockedIssues.length}
            label="Needs Attention"
            to="/issues"
            description={<span>{pendingApprovals.length} approvals waiting on review</span>}
          />
          <MetricCard
            icon={PlayCircle}
            value={data.agents.running}
            label="Live Execution"
            to="/agents"
            description={<span>{recentRunAlerts.length} active or failed runs worth checking</span>}
          />
          <MetricCard
            icon={DollarSign}
            value={formatCents(data.costs.monthSpendCents)}
            label="Month Spend"
            to="/costs"
            description={
              <span>
                {data.costs.monthBudgetCents > 0
                  ? `${data.costs.monthUtilizationPercent}% of ${formatCents(data.costs.monthBudgetCents)} budget`
                  : "No monthly cap configured"}
              </span>
            }
          />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
        <section className="rounded-xl border border-border bg-card/80 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Initiative Focus
            </h2>
          </div>
          {projectSnapshots.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No projects yet.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {projectSnapshots.map(({ project, active, blocked, todo, done, focusIssue }) => (
                <Link
                  key={project.id}
                  to={projectUrl(project)}
                  className="block rounded-xl border border-border px-4 py-4 text-inherit no-underline transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{project.name}</p>
                        <StatusBadge status={project.status} />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {active} active, {blocked} blocked, {todo} queued, {done} done
                      </p>
                      {focusIssue && (
                        <p className="mt-3 truncate text-sm text-foreground/90">
                          Focus now: {focusIssue.identifier ?? focusIssue.id.slice(0, 8)} - {focusIssue.title}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card/80 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Review Queue
            </h2>
          </div>
          {pendingApprovals.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No board decisions are waiting.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {pendingApprovals.map((approval) => (
                <Link
                  key={approval.id}
                  to={`/approvals/${approval.id}`}
                  className="block rounded-xl border border-border px-4 py-4 text-inherit no-underline transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {approvalTypeLabel[approval.type] ?? approval.type.replace(/_/g, " ")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Requested {timeAgo(approval.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={approval.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
        <section className="rounded-xl border border-border bg-card/80 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <CircleDot className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Active Work
            </h2>
          </div>
          {activeIssues.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No active work right now.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {activeIssues.map((issue) => {
                const assignee = issue.assigneeAgentId ? agentMap.get(issue.assigneeAgentId) : null;
                const project = issue.projectId ? projects?.find((item) => item.id === issue.projectId) : null;

                return (
                  <Link
                    key={issue.id}
                    to={issueUrl(issue)}
                    className="block rounded-xl border border-border px-4 py-4 text-inherit no-underline transition-colors hover:bg-accent/40"
                  >
                    <div className="flex items-start gap-3">
                      <PriorityIcon priority={issue.priority} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">{issue.title}</p>
                          <StatusBadge status={issue.status} />
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {issue.identifier ?? issue.id.slice(0, 8)}
                          {project ? ` · ${project.name}` : ""}
                          {` · updated ${timeAgo(issue.updatedAt)}`}
                        </p>
                        {assignee && (
                          <div className="mt-3">
                            <Identity name={assignee.name} size="sm" />
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card/80 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Watchlist
            </h2>
          </div>
          {blockedIssues.length === 0 && recentRunAlerts.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No blockers or run alerts right now.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {blockedIssues.map((issue) => (
                <Link
                  key={issue.id}
                  to={issueUrl(issue)}
                  className="block rounded-xl border border-border px-4 py-4 text-inherit no-underline transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-start gap-3">
                    <PriorityIcon priority={issue.priority} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{issue.title}</p>
                        <StatusBadge status={issue.status} />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {issue.identifier ?? issue.id.slice(0, 8)} · updated {timeAgo(issue.updatedAt)}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}

              {recentRunAlerts.map(({ run, agentName, issueId }) => {
                const issue = issueId ? issueMap.get(issueId) : null;

                return (
                  <Link
                    key={run.id}
                    to={`/agents/${run.agentId}/runs/${run.id}`}
                    className="block rounded-xl border border-border px-4 py-4 text-inherit no-underline transition-colors hover:bg-accent/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">
                            {run.status === "failed" ? "Run failed" : "Run active"}
                          </p>
                          <StatusBadge status={run.status} />
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {agentName} · {timeAgo(run.finishedAt ?? run.startedAt ?? run.createdAt)}
                        </p>
                        {issue && (
                          <p className="mt-2 truncate text-sm text-foreground/90">
                            Related issue: {issue.identifier ?? issue.id.slice(0, 8)} - {issue.title}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card/80 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent Outcomes
          </h2>
        </div>
        {recentOutcomes.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No completed work yet.</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {recentOutcomes.map((issue) => (
              <Link
                key={issue.id}
                to={issueUrl(issue)}
                className="block rounded-xl border border-border px-4 py-4 text-inherit no-underline transition-colors hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{issue.title}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {issue.identifier ?? issue.id.slice(0, 8)} · completed {timeAgo(issue.completedAt ?? issue.updatedAt)}
                    </p>
                  </div>
                  <StatusBadge status={issue.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <ActiveAgentsPanel companyId={selectedCompanyId!} />
    </div>
  );
}

import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/layout";
import DashboardPage from "@/pages/dashboard";
import RunsPage from "@/pages/runs";
import RunDetailPage from "@/pages/run-detail";
import MonitorPage from "@/pages/monitor";
import InContactPage from "@/pages/incontact";
import AgentsPage from "@/pages/agents";
import RecordingsPage from "@/pages/recordings";
import AuditPage from "@/pages/audit";
import ScriptsPage from "@/pages/scripts";
import DispositionRefreshPage from "@/pages/disposition-refresh";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/runs" component={RunsPage} />
        <Route path="/runs/:id" component={RunDetailPage} />
        <Route path="/monitor" component={MonitorPage} />
        <Route path="/incontact" component={InContactPage} />
        <Route path="/agents" component={AgentsPage} />
        <Route path="/recordings" component={RecordingsPage} />
        <Route path="/audit" component={AuditPage} />
        <Route path="/scripts" component={ScriptsPage} />
        <Route path="/disposition-refresh" component={DispositionRefreshPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

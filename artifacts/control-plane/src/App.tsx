import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/layout";
import DashboardPage from "@/pages/dashboard";
import SourceSystemsPage from "@/pages/source-systems";
import EndpointsPage from "@/pages/endpoints";
import RunsPage from "@/pages/runs";
import RunDetailPage from "@/pages/run-detail";
import RunNewPage from "@/pages/run-new";
import MonitorPage from "@/pages/monitor";
import InContactPage from "@/pages/incontact";
import StagingPage from "@/pages/staging";
import RecordingsPage from "@/pages/recordings";
import AuditPage from "@/pages/audit";
import ScriptsPage from "@/pages/scripts";
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
        <Route path="/source-systems" component={SourceSystemsPage} />
        <Route path="/endpoints" component={EndpointsPage} />
        <Route path="/runs" component={RunsPage} />
        <Route path="/runs/new" component={RunNewPage} />
        <Route path="/runs/:id" component={RunDetailPage} />
        <Route path="/monitor" component={MonitorPage} />
        <Route path="/incontact" component={InContactPage} />
        <Route path="/staging" component={StagingPage} />
        <Route path="/recordings" component={RecordingsPage} />
        <Route path="/audit" component={AuditPage} />
        <Route path="/scripts" component={ScriptsPage} />
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

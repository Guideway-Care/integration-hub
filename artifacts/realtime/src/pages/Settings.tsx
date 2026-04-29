import { useSettingsStore } from "@/hooks/use-nice-data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity } from "lucide-react";

export default function Settings() {
  const { refreshInterval, setRefreshInterval, isPaused, setIsPaused } = useSettingsStore();

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">Configure your NOC dashboard preferences</p>
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="w-5 h-5 text-primary" />
            Telemetry Polling
          </CardTitle>
          <CardDescription>
            Control how frequently the dashboard requests new data from the NICE CXone API.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Pause Polling</Label>
              <p className="text-sm text-muted-foreground">
                Temporarily halt all API requests. Useful for preserving rate limits or freezing state for analysis.
              </p>
            </div>
            <Switch 
              checked={isPaused} 
              onCheckedChange={setIsPaused}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-base">Refresh Interval</Label>
            <p className="text-sm text-muted-foreground mb-4">
              How often to sync with the server when polling is active.
            </p>
            <Select 
              value={refreshInterval.toString()} 
              onValueChange={(val) => setRefreshInterval(parseInt(val, 10))}
              disabled={isPaused}
            >
              <SelectTrigger className="w-[200px] bg-black/20 border-border/50">
                <SelectValue placeholder="Select interval" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5000">5 seconds (Aggressive)</SelectItem>
                <SelectItem value="10000">10 seconds (Default)</SelectItem>
                <SelectItem value="30000">30 seconds</SelectItem>
                <SelectItem value="60000">1 minute (Relaxed)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      
      <div className="text-xs text-muted-foreground/50 text-center">
        Settings are saved locally to this browser profile.
      </div>
    </div>
  );
}

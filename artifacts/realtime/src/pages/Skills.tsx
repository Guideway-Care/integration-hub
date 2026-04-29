import { useNiceQuery } from "@/hooks/use-nice-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { GenericTable, RawDataViewer } from "@/components/RawDataViewer";

export default function Skills() {
  const { data: response, isLoading, isError, error, isFetching } = useNiceQuery("skills");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Skills Activity</h2>
          <p className="text-sm text-muted-foreground">Queue and routing activity</p>
        </div>
        {isFetching && <RefreshCw className="w-4 h-4 animate-spin text-primary" />}
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>API Error</AlertTitle>
          <AlertDescription>{error?.message}</AlertDescription>
        </Alert>
      )}

      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-lg font-medium">Activity Data</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && !response ? (
            <div className="p-8 text-center text-muted-foreground">Loading skills data...</div>
          ) : (
            <GenericTable data={response?.data} />
          )}
        </CardContent>
      </Card>

      <div className="mt-8">
        <RawDataViewer data={response?.data} title="Raw API Response (Skills)" />
      </div>
    </div>
  );
}

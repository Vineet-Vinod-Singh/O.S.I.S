import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/qa")({
  component: QADashboard,
});

function QADashboard() {
  const [adminToken, setAdminToken] = useState(localStorage.getItem("qa_admin_token") || "");
  const queryClient = useQueryClient();

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setAdminToken(val);
    localStorage.setItem("qa_admin_token", val);
  };

  const { data: suites, error: suitesError } = useQuery({
    queryKey: ["qa-suites"],
    queryFn: async () => {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/qa/suites`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
        },
      );
      if (!res.ok) throw new Error("Unauthorized or failed to fetch suites");
      return res.json();
    },
    enabled: !!adminToken,
    retry: false,
  });

  const { data: runs, refetch: refetchRuns } = useQuery({
    queryKey: ["qa-runs"],
    queryFn: async () => {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/qa/runs`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
        },
      );
      if (!res.ok) throw new Error("Failed to fetch runs");
      const data = await res.json();
      return data.runs;
    },
    enabled: !!adminToken,
    refetchInterval: 5000, // Poll every 5s
  });

  const triggerMutation = useMutation({
    mutationFn: async (suite: any) => {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/qa/runs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({ suiteName: suite.name, task: suite.task }),
        },
      );
      if (!res.ok) throw new Error("Failed to trigger run");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-runs"] });
    },
  });

  if (!adminToken) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">QA Subsystem Login</h1>
        <div className="flex flex-col gap-2">
          <label>Admin Token (e.g. TinyFish admin token):</label>
          <input
            type="password"
            className="border p-2 rounded"
            value={adminToken}
            onChange={handleTokenChange}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">TinyFish AI QA Dashboard</h1>
        <button
          onClick={() => {
            setAdminToken("");
            localStorage.removeItem("qa_admin_token");
          }}
          className="text-sm text-red-500 hover:underline"
        >
          Logout
        </button>
      </div>

      {suitesError && (
        <div className="text-red-500 font-medium">
          Failed to load: {(suitesError as Error).message}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-8">
        {/* Suites section */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Available Test Suites</h2>
          <div className="space-y-4">
            {suites?.suites?.map((suite: any) => (
              <div
                key={suite.id}
                className="p-4 border rounded shadow-sm bg-white dark:bg-gray-800"
              >
                <h3 className="font-bold text-lg">{suite.name}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{suite.task}</p>
                <button
                  disabled={triggerMutation.isPending}
                  onClick={() => triggerMutation.mutate(suite)}
                  className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {triggerMutation.isPending ? "Triggering..." : "Run Suite"}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Runs section */}
        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Recent QA Runs</h2>
            <button onClick={() => refetchRuns()} className="text-sm text-blue-500 hover:underline">
              Refresh
            </button>
          </div>
          <div className="space-y-4">
            {runs?.map((run: any) => (
              <div
                key={run.id}
                className="p-4 border rounded shadow-sm bg-white dark:bg-gray-800 flex flex-col gap-2"
              >
                <div className="flex justify-between">
                  <span className="font-bold">{run.suite}</span>
                  <span
                    className={`px-2 py-1 text-xs rounded font-bold uppercase
                    ${
                      run.status === "completed"
                        ? "bg-green-100 text-green-800"
                        : run.status === "failed"
                          ? "bg-red-100 text-red-800"
                          : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {run.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(run.createdAt).toLocaleString()}
                </div>
                {run.error && (
                  <div className="text-sm text-red-600 bg-red-50 p-2 rounded mt-2 border border-red-200">
                    {run.error}
                  </div>
                )}
              </div>
            ))}
            {runs?.length === 0 && <p className="text-gray-500 text-sm">No runs yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

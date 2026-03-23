import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function InspectorGate() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (localStorage.getItem("hoa_inspector") === "true") {
      navigate("/inspector/streets", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === import.meta.env.VITE_INSPECTOR_PASSWORD) {
      localStorage.setItem("hoa_inspector", "true");
      navigate("/inspector/streets");
    } else {
      setError("Incorrect password");
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Inspector Login</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit">Enter</Button>
            <button
              type="button"
              className="text-sm text-muted-foreground hover:underline"
              onClick={() => navigate("/")}
            >
              Back
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

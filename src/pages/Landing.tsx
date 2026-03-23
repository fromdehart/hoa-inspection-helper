import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function Landing() {
  const navigate = useNavigate();
  const isAdmin = localStorage.getItem("hoa_admin") === "true";
  const isInspector = localStorage.getItem("hoa_inspector") === "true";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 px-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">HOA Inspection Helper</h1>
        <p className="text-muted-foreground">Select your role to continue</p>
      </div>
      <div className="flex flex-col gap-4 w-full max-w-sm">
        <Button size="lg" className="h-16 text-lg" onClick={() => navigate("/admin")}>
          Admin Login
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-16 text-lg"
          onClick={() => navigate("/inspector")}
        >
          Inspector Login
        </Button>
      </div>
      {(isAdmin || isInspector) && (
        <div className="flex flex-col gap-2 text-center">
          <p className="text-sm text-muted-foreground">Quick access</p>
          {isAdmin && (
            <button
              className="text-blue-600 hover:underline text-sm"
              onClick={() => navigate("/admin/dashboard")}
            >
              Admin Dashboard →
            </button>
          )}
          {isInspector && (
            <button
              className="text-blue-600 hover:underline text-sm"
              onClick={() => navigate("/inspector/streets")}
            >
              Inspector Streets →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

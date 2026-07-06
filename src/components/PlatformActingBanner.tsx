import { useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

type PlatformActingBannerProps = {
  hoaName: string;
  /** Which layer granted the acting session; company managers exit back to their portfolio. */
  actingVia?: "platform" | "company" | null;
};

export default function PlatformActingBanner({ hoaName, actingVia }: PlatformActingBannerProps) {
  const navigate = useNavigate();
  const clearPlatformActing = useMutation(api.platform.clearActingHoa);
  const clearCompanyActing = useMutation(api.company.clearActingHoa);
  const isCompany = actingVia === "company";

  const handleExit = async () => {
    if (isCompany) {
      await clearCompanyActing({});
      navigate("/portfolio");
    } else {
      await clearPlatformActing({});
      navigate("/platform/hoas");
    }
  };

  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2 text-sm flex items-center justify-between gap-3">
      <span>
        <strong>{isCompany ? "Managing community:" : "Acting as admin:"}</strong> {hoaName}
      </span>
      <button
        type="button"
        onClick={() => void handleExit()}
        className="rounded-md bg-amber-950/10 px-3 py-1 text-xs font-semibold hover:bg-amber-950/20"
      >
        {isCompany ? "Back to portfolio" : "Exit neighborhood"}
      </button>
    </div>
  );
}

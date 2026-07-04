import { useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

type PlatformActingBannerProps = {
  hoaName: string;
};

export default function PlatformActingBanner({ hoaName }: PlatformActingBannerProps) {
  const navigate = useNavigate();
  const clearActingHoa = useMutation(api.platform.clearActingHoa);

  const handleExit = async () => {
    await clearActingHoa({});
    navigate("/platform/hoas");
  };

  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2 text-sm flex items-center justify-between gap-3">
      <span>
        <strong>Acting as admin:</strong> {hoaName}
      </span>
      <button
        type="button"
        onClick={() => void handleExit()}
        className="rounded-md bg-amber-950/10 px-3 py-1 text-xs font-semibold hover:bg-amber-950/20"
      >
        Exit neighborhood
      </button>
    </div>
  );
}

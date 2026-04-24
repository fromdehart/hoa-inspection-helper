import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Settings() {
  const navigate = useNavigate();
  const [rules, setRules] = useState("");
  const [colors, setColors] = useState("");
  const [guidelines, setGuidelines] = useState("");
  const [letterTpl, setLetterTpl] = useState("");
  const [reportTpl, setReportTpl] = useState("");
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const aiConfig = useQuery(api.aiConfig.getAll);
  const letterTemplate = useQuery(api.templates.get, { type: "letter" });
  const reportTemplate = useQuery(api.templates.get, { type: "report" });

  const setAiConfig = useMutation(api.aiConfig.set);
  const setTemplate = useMutation(api.templates.set);

  useEffect(() => {
    if (aiConfig) {
      setRules(aiConfig.violationRules);
      setColors(aiConfig.approvedColors);
      setGuidelines(aiConfig.hoaGuidelines);
    }
  }, [aiConfig]);

  useEffect(() => {
    if (letterTemplate) setLetterTpl(letterTemplate.content);
  }, [letterTemplate]);

  useEffect(() => {
    if (reportTemplate) setReportTpl(reportTemplate.content);
  }, [reportTemplate]);

  const flashSaved = (key: string) => {
    setSaved((s) => ({ ...s, [key]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [key]: false })), 2000);
  };

  const handleAiBlur = async (key: string, value: string) => {
    await setAiConfig({ key, value });
    flashSaved(key);
  };

  return (
    <div className="min-h-screen bg-[#f8f7ff]">
      <div className="gradient-admin px-4 pt-8 pb-5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-sm text-purple-100 hover:text-white font-medium transition-colors"
            onClick={() => navigate("/admin/dashboard")}
          >
            ← Dashboard
          </button>
          <h1 className="font-extrabold text-white text-xl">⚙️ Settings</h1>
          <div className="w-20" />
        </div>
        <p className="text-purple-200 text-xs mt-2 text-center">Letter templates & reference text</p>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8">
        {/* AI Config */}
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800 mb-1">Reference text (optional)</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Stored for your records. Photo-based AI inspection is disabled; letter generation may still use
            OpenAI when configured, to polish wording from inspector notes or violation lists.
          </p>

          <div className="space-y-4">
            {[
              { key: "violationRules", label: "Violation Rules", value: rules, setter: setRules },
              { key: "approvedColors", label: "Approved Colors", value: colors, setter: setColors },
              { key: "hoaGuidelines", label: "HOA Guidelines", value: guidelines, setter: setGuidelines },
            ].map(({ key, label, value, setter }) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">{label}</label>
                  {saved[key] && (
                    <span className="text-xs text-green-600">✓ Saved</span>
                  )}
                </div>
                <Textarea
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  onBlur={() => handleAiBlur(key, value)}
                  rows={4}
                  placeholder={`Enter ${label.toLowerCase()}...`}
                />
              </div>
            ))}
          </div>
        </section>

        {/* Templates */}
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800 mb-2">Templates</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Available variables: <code className="bg-muted px-1 rounded">{"{{address}}"}</code>{" "}
            <code className="bg-muted px-1 rounded">{"{{violations}}"}</code>{" "}
            <code className="bg-muted px-1 rounded">{"{{inspectorFindings}}"}</code>{" "}
            <code className="bg-muted px-1 rounded">{"{{priorInspectionReference}}"}</code>{" "}
            <code className="bg-muted px-1 rounded">{"{{portalLink}}"}</code>{" "}
            <code className="bg-muted px-1 rounded">{"{{date}}"}</code>
          </p>
          <Tabs defaultValue="letter">
            <TabsList>
              <TabsTrigger value="letter">Letter Template</TabsTrigger>
              <TabsTrigger value="report">Report Template</TabsTrigger>
            </TabsList>
            <TabsContent value="letter" className="space-y-2">
              <Textarea
                value={letterTpl}
                onChange={(e) => setLetterTpl(e.target.value)}
                rows={20}
                className="font-mono text-sm"
                placeholder="Enter HTML letter template..."
              />
              <Button onClick={() => setTemplate({ type: "letter", content: letterTpl }).then(() => flashSaved("letterTpl"))}>
                Save Template {saved.letterTpl && <span className="ml-2 text-green-300">✓</span>}
              </Button>
            </TabsContent>
            <TabsContent value="report" className="space-y-2">
              <Textarea
                value={reportTpl}
                onChange={(e) => setReportTpl(e.target.value)}
                rows={20}
                className="font-mono text-sm"
                placeholder="Enter HTML report template..."
              />
              <Button onClick={() => setTemplate({ type: "report", content: reportTpl }).then(() => flashSaved("reportTpl"))}>
                Save Template {saved.reportTpl && <span className="ml-2 text-green-300">✓</span>}
              </Button>
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </div>
  );
}

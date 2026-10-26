"use client";

import { useEffect, useMemo, useState } from "react";
import { VIZ_TYPE_LABELS } from "@/components/visualization/VisualizationCard";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlanForDataset } from "@/components/visualization/usePlanForDataset";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVisualizationStore } from "@/stores/visualizationStore";
import type {
  AggregationType,
  DashboardWidget,
  DashboardWidgetWidth,
  Dataset,
  MetricWidgetConfig,
  TextWidgetConfig,
  Visualization,
} from "@/lib/types";

type Mode = "visualization" | "metric" | "text";
type MetricFormat = NonNullable<MetricWidgetConfig["format"]>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: Dataset;
  /** Демо-дашборд: поля плана — демо-проекта (как у его виджетов). */
  demoDashboard?: boolean;
  editingWidget?: DashboardWidget | null;
  onAdd: (
    widget: Omit<DashboardWidget, "id" | "sheetId">,
  ) => Promise<void>;
}

export function AddWidgetDialog({
  open,
  onOpenChange,
  dataset,
  demoDashboard = false,
  editingWidget,
  onAdd,
}: Props) {
  const [mode, setMode] = useState<Mode>("visualization");
  const [saving, setSaving] = useState(false);

  const allVisualizations = useVisualizationStore((s) => s.visualizations);
  const datasetVisualizations = useMemo(
    () => allVisualizations.filter((v) => v.datasetId === dataset.id),
    [allVisualizations, dataset.id],
  );

  const [vizId, setVizId] = useState<string>(
    datasetVisualizations[0]?.id ?? "",
  );
  const [vizWidth, setVizWidth] = useState<DashboardWidgetWidth>("full");

  const [metricTitle, setMetricTitle] = useState("Метрика");
  const measures = useMemo(() => {
    const cols = dataset.columns
      .filter((c) => c.enabled)
      .filter((c) => c.datasetType === "integer" || c.datasetType === "float");
    const calcs = (dataset.calculatedFields ?? []).map((c) => ({
      name: c.name,
      datasetType: c.datasetType,
    }));
    return [...cols.map((c) => ({ name: c.name })), ...calcs.map((c) => ({ name: c.name }))];
  }, [dataset]);
  // Поля плана датасета — группа «План» в выборе столбца метрики.
  // Метрика из шаблона «Собрать дашборд» помнит свой проект — и после смены столбца.
  const planProjectId =
    editingWidget?.widgetType === "metric"
      ? (editingWidget.config as Partial<MetricWidgetConfig>).planProjectId
      : undefined;
  const { virtualFields: planFields } = usePlanForDataset(dataset.id, {
    demoObject: demoDashboard,
    projectId: planProjectId,
  });
  const planColumns = useMemo(() => planFields.map((f) => f.name), [planFields]);
  const [metricColumn, setMetricColumn] = useState<string>(
    measures[0]?.name ?? "",
  );
  const chooseMetricColumn = (v: string) => {
    setMetricColumn(v);
    // Выполнение плана хранится в процентах (88 = 88%) — сразу формат «%».
    if (planFields.some((f) => f.name === v && f.virtualKind === "completion")) {
      setMetricFormat("percent");
    }
  };
  const [metricAgg, setMetricAgg] = useState<AggregationType>("SUM");
  // «Авто» — формат наследуется от поля (`CPI ₽` → ₽, `spend_usd` → $).
  const [metricFormat, setMetricFormat] = useState<MetricFormat>("auto");
  const [metricWidth, setMetricWidth] = useState<DashboardWidgetWidth>("third");

  const [textValue, setTextValue] = useState("");
  const [textWidth, setTextWidth] = useState<DashboardWidgetWidth>("full");

  // Предзаполняем форму при редактировании существующего виджета.
  useEffect(() => {
    if (!open) return;
    if (!editingWidget) {
      setMode("visualization");
      return;
    }
    if (editingWidget.widgetType === "metric") {
      setMode("metric");
      const cfg = editingWidget.config as Partial<MetricWidgetConfig>;
      setMetricTitle(editingWidget.title || "Метрика");
      setMetricColumn(cfg.column ?? measures[0]?.name ?? "");
      setMetricAgg(cfg.aggregation ?? "SUM");
      setMetricFormat(cfg.format ?? "auto");
      setMetricWidth(editingWidget.width);
    } else if (editingWidget.widgetType === "text") {
      setMode("text");
      const cfg = editingWidget.config as Partial<TextWidgetConfig>;
      setTextValue(cfg.text ?? "");
      setTextWidth(editingWidget.width);
    } else {
      setMode("visualization");
      if (editingWidget.visualizationId) setVizId(editingWidget.visualizationId);
      setVizWidth(editingWidget.width);
    }
  }, [open, editingWidget, measures]);

  async function handleAdd() {
    setSaving(true);
    try {
      const baseSortOrder = editingWidget
        ? editingWidget.sortOrder
        : Date.now();
      if (mode === "visualization") {
        const viz = datasetVisualizations.find((v) => v.id === vizId);
        if (!viz) return;
        await onAdd({
          visualizationId: viz.id,
          widgetType: viz.type === "pivot" ? "pivot" : "chart",
          title: viz.name,
          config: {},
          sortOrder: baseSortOrder,
          width: vizWidth,
        });
      } else if (mode === "metric") {
        // Подпись/светофор шаблона план/факт (`caption`, `plan`) сохраняем,
        // пока столбец метрики тот же.
        const prev =
          editingWidget?.widgetType === "metric" &&
          (editingWidget.config as Partial<MetricWidgetConfig>).column === metricColumn
            ? editingWidget.config
            : {};
        const cfg: MetricWidgetConfig = {
          ...(prev as Partial<MetricWidgetConfig>),
          column: metricColumn,
          aggregation: metricAgg,
          format: metricFormat,
          ...(planProjectId ? { planProjectId } : {}),
        };
        await onAdd({
          widgetType: "metric",
          title: metricTitle || "Метрика",
          config: cfg as unknown as Record<string, unknown>,
          sortOrder: baseSortOrder,
          width: metricWidth,
        });
      } else {
        const cfg: TextWidgetConfig = { text: textValue };
        await onAdd({
          widgetType: "text",
          title: "Текст",
          config: cfg as unknown as Record<string, unknown>,
          sortOrder: baseSortOrder,
          width: textWidth,
        });
      }
      onOpenChange(false);
      if (!editingWidget) setTextValue("");
    } finally {
      setSaving(false);
    }
  }

  const addDisabled =
    (mode === "visualization" && !vizId) ||
    (mode === "metric" && !metricColumn) ||
    (mode === "text" && !textValue.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editingWidget ? "Настроить виджет" : "Добавить виджет"}
          </DialogTitle>
          <DialogDescription>
            {editingWidget
              ? "Измените параметры виджета и сохраните."
              : "Виджет появится на текущем активном листе."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="visualization">Визуализация</TabsTrigger>
            <TabsTrigger value="metric">Метрика</TabsTrigger>
            <TabsTrigger value="text">Текст</TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "visualization" && (
          <VisualizationForm
            visualizations={datasetVisualizations}
            vizId={vizId}
            setVizId={setVizId}
            width={vizWidth}
            setWidth={setVizWidth}
          />
        )}

        {mode === "metric" && (
          <MetricForm
            title={metricTitle}
            setTitle={setMetricTitle}
            column={metricColumn}
            setColumn={chooseMetricColumn}
            columns={measures.map((m) => m.name)}
            planColumns={planColumns}
            aggregation={metricAgg}
            setAggregation={setMetricAgg}
            format={metricFormat}
            setFormat={setMetricFormat}
            width={metricWidth}
            setWidth={setMetricWidth}
          />
        )}

        {mode === "text" && (
          <TextForm
            value={textValue}
            setValue={setTextValue}
            width={textWidth}
            setWidth={setTextWidth}
          />
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Отмена
          </Button>
          <Button
            variant="gradient"
            onClick={handleAdd}
            disabled={saving || addDisabled}
          >
            {saving && <Loader2 className="animate-spin" />}
            {editingWidget ? "Сохранить" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WidthSelect({
  value,
  onChange,
}: {
  value: DashboardWidgetWidth;
  onChange: (v: DashboardWidgetWidth) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Ширина</Label>
      <Select value={value} onValueChange={(v) => onChange(v as DashboardWidgetWidth)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="full">Full (100%)</SelectItem>
          <SelectItem value="half">Half (50%)</SelectItem>
          <SelectItem value="third">Third (33%)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function VisualizationForm({
  visualizations,
  vizId,
  setVizId,
  width,
  setWidth,
}: {
  visualizations: Visualization[];
  vizId: string;
  setVizId: (v: string) => void;
  width: DashboardWidgetWidth;
  setWidth: (w: DashboardWidgetWidth) => void;
}) {
  const viz = visualizations.find((v) => v.id === vizId);
  return (
    <div className="space-y-3 pt-2">
      <div className="space-y-1.5">
        <Label>Визуализация</Label>
        <Select value={vizId} onValueChange={setVizId}>
          <SelectTrigger>
            <SelectValue placeholder="Выберите визуализацию" />
          </SelectTrigger>
          <SelectContent>
            {visualizations.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                Нет сохранённых визуализаций для этого датасета
              </div>
            ) : (
              visualizations.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      {viz && (
        <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          <div>
            Тип:{" "}
            <span className="text-foreground">{VIZ_TYPE_LABELS[viz.type] ?? viz.type}</span>
          </div>
          {viz.config.xAxis && (
            <div>
              X:{" "}
              <span className="font-mono text-foreground">
                {viz.config.xAxis}
              </span>
            </div>
          )}
          {viz.config.yAxis && (
            <div>
              Y:{" "}
              <span className="font-mono text-foreground">
                {viz.config.yAxis.aggregation}({viz.config.yAxis.column})
              </span>
            </div>
          )}
        </div>
      )}
      <WidthSelect value={width} onChange={setWidth} />
    </div>
  );
}

function MetricForm({
  title,
  setTitle,
  column,
  setColumn,
  columns,
  planColumns,
  aggregation,
  setAggregation,
  format,
  setFormat,
  width,
  setWidth,
}: {
  title: string;
  setTitle: (v: string) => void;
  column: string;
  setColumn: (v: string) => void;
  columns: string[];
  /** Виртуальные поля плана (`· выполнение %` красится светофором). */
  planColumns?: string[];
  aggregation: AggregationType;
  setAggregation: (v: AggregationType) => void;
  format: MetricFormat;
  setFormat: (v: MetricFormat) => void;
  width: DashboardWidgetWidth;
  setWidth: (v: DashboardWidgetWidth) => void;
}) {
  return (
    <div className="space-y-3 pt-2">
      <div className="space-y-1.5">
        <Label>Название</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Например: Общий Revenue"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Столбец</Label>
          <Select value={column} onValueChange={setColumn}>
            <SelectTrigger>
              <SelectValue placeholder="Выбрать" />
            </SelectTrigger>
            <SelectContent>
              {columns.map((c) => (
                <SelectItem key={c} value={c} className="font-mono text-xs">
                  {c}
                </SelectItem>
              ))}
              {planColumns && planColumns.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel className="text-primary">План</SelectLabel>
                    {planColumns.map((c) => (
                      <SelectItem key={c} value={c} className="text-xs">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Агрегация</Label>
          <Select
            value={aggregation}
            onValueChange={(v) => setAggregation(v as AggregationType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SUM">SUM</SelectItem>
              <SelectItem value="AVG">AVG</SelectItem>
              <SelectItem value="COUNT">COUNT</SelectItem>
              <SelectItem value="MIN">MIN</SelectItem>
              <SelectItem value="MAX">MAX</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Формат</Label>
        <Select
          value={format}
          onValueChange={(v) => setFormat(v as MetricFormat)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Авто (как у поля)</SelectItem>
            <SelectItem value="number">Число</SelectItem>
            <SelectItem value="integer">Целое</SelectItem>
            <SelectItem value="currency_rub">Рубли (₽)</SelectItem>
            <SelectItem value="currency_usd">Доллары ($)</SelectItem>
            {/* Старое значение «Валюта ($)» — показываем, только если уже выбрано. */}
            {format === "currency" && (
              <SelectItem value="currency">Валюта ($)</SelectItem>
            )}
            <SelectItem value="percent">Процент (%)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <WidthSelect value={width} onChange={setWidth} />
    </div>
  );
}

function TextForm({
  value,
  setValue,
  width,
  setWidth,
}: {
  value: string;
  setValue: (v: string) => void;
  width: DashboardWidgetWidth;
  setWidth: (v: DashboardWidgetWidth) => void;
}) {
  return (
    <div className="space-y-3 pt-2">
      <div className="space-y-1.5">
        <Label>Текст</Label>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Заметка, описание или комментарий"
          rows={5}
        />
      </div>
      <WidthSelect value={width} onChange={setWidth} />
    </div>
  );
}

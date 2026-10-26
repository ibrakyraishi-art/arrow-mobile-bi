-- 015: удаление источника/датасета «подчистую» — без осиротевших хвостов.
-- Применено к prod через MCP; здесь для воспроизводимости. Идемпотентно.
--
-- Было: при удалении датасета алерт-правило и виджет дашборда лишь обнуляли
-- ссылку (SET NULL) и оставались висеть в БД. Стало: каскадно удаляются.
-- Полная цепочка от источника:
--   data_sources -> datasets (CASCADE, было) -> visualizations (CASCADE, было)
--                                            -> alert_rules (теперь CASCADE)
--                                                 -> alert_runs (CASCADE, было)
--   visualizations -> dashboard_widgets (теперь CASCADE)
--   data_sources -> file_sources (CASCADE, было)
-- RLS не затрагивается.

ALTER TABLE public.alert_rules DROP CONSTRAINT IF EXISTS alert_rules_dataset_id_fkey;
ALTER TABLE public.alert_rules
  ADD CONSTRAINT alert_rules_dataset_id_fkey
  FOREIGN KEY (dataset_id) REFERENCES public.datasets(id) ON DELETE CASCADE;

ALTER TABLE public.dashboard_widgets DROP CONSTRAINT IF EXISTS dashboard_widgets_visualization_id_fkey;
-- schema-dashboards.sql создаёт visualization_id как TEXT (под демо-id «demo-viz-…»),
-- а visualizations.id — UUID: FK между ними невозможен («foreign key constraint
-- cannot be implemented»). Раз FK применён на проде, там колонка уже uuid —
-- приводим тип. На uuid-колонке это no-op; если в колонке есть не-UUID значения
-- (демо-id), команда упадёт — такие строки нужно удалить заранее.
ALTER TABLE public.dashboard_widgets
  ALTER COLUMN visualization_id TYPE uuid USING visualization_id::uuid;
ALTER TABLE public.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_visualization_id_fkey
  FOREIGN KEY (visualization_id) REFERENCES public.visualizations(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';

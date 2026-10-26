-- 016: чистка AI-проектов при удалении датасета (часть «удаления подчистую»).
-- Применено к prod через MCP; здесь для воспроизводимости. Идемпотентно.
--
-- Проблема: ai_projects.dataset_id хранится как TEXT (поддерживает демо-id вроде
-- 'demo-dataset-campaigns'), поэтому внешний ключ/каскад на datasets невозможен.
-- При удалении датасета (в т.ч. каскадном от источника) AI-проекты оставались
-- осиротевшими (dataset_id указывал на несуществующий датасет).
--
-- Решение: триггер AFTER DELETE на datasets удаляет ai_projects этого датасета.
-- Дочерние ai_project_runs / ai_anonymization_maps уйдут каскадом (их FK на
-- ai_projects уже ON DELETE CASCADE). Демо-проекты не затрагиваются: для демо
-- реальная строка datasets не удаляется, значит событие не срабатывает.

create or replace function public.delete_ai_projects_for_dataset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ai_projects where dataset_id = old.id::text;
  return old;
end;
$$;

drop trigger if exists trg_datasets_cleanup_ai_projects on public.datasets;
create trigger trg_datasets_cleanup_ai_projects
  after delete on public.datasets
  for each row execute function public.delete_ai_projects_for_dataset();

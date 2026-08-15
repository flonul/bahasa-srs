-- ============================================================
-- Migration : mode "Erreurs récentes"
-- Ajoute le suivi de la dernière erreur par item, pour permettre
-- une session de révision ciblée sur les mots ratés dans les 24h.
-- ============================================================

-- 1) Nouvelle colonne : horodatage de la dernière réponse incorrecte
alter table user_items
  add column if not exists last_wrong_at timestamptz;

-- 2) Trigger : incrémente automatiquement last_wrong_at dès que
--    wrong_count augmente, quelle que soit la façon dont
--    apply_review_results() met à jour la ligne (UPDATE classique
--    ou upsert avec ON CONFLICT DO UPDATE — les deux déclenchent
--    un trigger BEFORE UPDATE au niveau ligne).
--    Choix volontaire de ne PAS toucher à apply_review_results()
--    directement : son corps actuel n'est pas versionné dans ce
--    repo, ce trigger reste donc valable quelle que soit son
--    implémentation exacte, tant qu'elle incrémente wrong_count.
create or replace function set_last_wrong_at()
returns trigger
language plpgsql
as $$
begin
  if new.wrong_count > old.wrong_count then
    new.last_wrong_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_last_wrong_at on user_items;

create trigger trg_set_last_wrong_at
  before update on user_items
  for each row
  execute function set_last_wrong_at();

-- Rien à faire côté RLS : le trigger s'exécute dans le même
-- contexte que l'UPDATE déjà autorisé par les policies existantes.

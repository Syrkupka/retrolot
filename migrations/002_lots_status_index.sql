-- запит головної сторінки: активні лоти за часом завершення (план до/після індексу в docs/query-plan.md)
CREATE INDEX lots_status_ends ON lots(status, ends_at);

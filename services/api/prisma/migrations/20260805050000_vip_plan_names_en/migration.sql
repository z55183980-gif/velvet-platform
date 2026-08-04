-- VIP plan display copy: Chinese → English (public API returns name/badge as-is).
UPDATE "vip_plans" SET "name" = 'Monthly', "badge" = 'Popular' WHERE "durationDays" = 30;
UPDATE "vip_plans" SET "name" = 'Quarterly', "badge" = NULL WHERE "durationDays" = 90;
UPDATE "vip_plans" SET "name" = 'Yearly', "badge" = 'Best value' WHERE "durationDays" = 365;

-- Fallback for non-standard duration rows that still use Chinese labels.
UPDATE "vip_plans" SET "name" = 'Monthly' WHERE "name" IN ('月卡', '一个月', '30天');
UPDATE "vip_plans" SET "name" = 'Quarterly' WHERE "name" IN ('季卡', '三个月', '90天');
UPDATE "vip_plans" SET "name" = 'Yearly' WHERE "name" IN ('年卡', '一年', '365天');
UPDATE "vip_plans" SET "badge" = 'Popular' WHERE "badge" IN ('热门', '推荐');
UPDATE "vip_plans" SET "badge" = 'Best value' WHERE "badge" IN ('超值', '最划算');

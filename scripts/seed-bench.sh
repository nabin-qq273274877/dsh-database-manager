#!/bin/sh
# Seed a production-sized Redis database for the level-scanner benchmark.
# Run inside the container:
#   docker exec redis sh /tmp/seed-bench.sh 1
set -e
DB="${1:-1}"

echo "seeding db$DB ..."

seed_prefix() {
  prefix="$1"
  count="$2"
  i=1
  while [ "$i" -le "$count" ]; do
    echo "SET ${prefix}:${i} v${i}"
    i=$((i + 1))
  done | redis-cli -n "$DB" --pipe > /dev/null
  echo "  $prefix: $count"
}

seed_prefix goods 200000
seed_prefix order:2024 20000
seed_prefix user:profile 20000
seed_prefix cache:page 20000

i=1
while [ "$i" -le 5000 ]; do
  echo "HSET session:${i} user u${i}"
  i=$((i + 1))
done | redis-cli -n "$DB" --pipe > /dev/null
echo "  session: 5000 hashes"

redis-cli -n "$DB" RPUSH list:demo a b c > /dev/null
redis-cli -n "$DB" SADD set:demo x y z > /dev/null
redis-cli -n "$DB" ZADD zset:demo 1 one 2 two > /dev/null
redis-cli -n "$DB" SET str:demo hello > /dev/null

echo "db$DB total: $(redis-cli -n "$DB" DBSIZE)"

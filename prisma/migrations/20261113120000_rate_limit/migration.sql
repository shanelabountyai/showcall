-- K5 / SEC-07: fixed-window counters for the public portals, in Postgres so a
-- limit holds across serverless instances and cold starts.
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key","windowStart")
);

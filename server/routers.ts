import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getConversionsByUser,
  getConversionById,
  getSlidesByConversion,
  deleteConversion,
} from "./db";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  conversions: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getConversionsByUser(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const conversion = await getConversionById(input.id);
        if (!conversion) throw new TRPCError({ code: "NOT_FOUND" });
        if (conversion.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        const slideList = await getSlidesByConversion(input.id);
        return { ...conversion, slides: slideList.sort((a, b) => a.pageNum - b.pageNum) };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const conversion = await getConversionById(input.id);
        if (!conversion) throw new TRPCError({ code: "NOT_FOUND" });
        if (conversion.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        await deleteConversion(input.id);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;

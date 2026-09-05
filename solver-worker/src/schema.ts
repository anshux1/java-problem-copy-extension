import { z } from "zod";

const fieldSchema = z.object({
  label: z.string().trim().min(1).max(200),
  value: z.string().max(10_000)
});

const cardSchema = z.object({
  title: z.string().trim().min(1).max(200),
  fields: z.array(fieldSchema).max(30)
});

export const solveRequestSchema = z.object({
  language: z.string().trim().min(1).max(100),
  starterCode: z.string().min(1).max(30_000),
  problem: z.string().trim().min(1).max(20_000),
  functional: z.string().max(10_000).default(""),
  constraints: z.string().max(10_000).default(""),
  inputFormat: z.string().max(10_000),
  outputFormat: z.string().max(10_000),
  logical: z.array(cardSchema).max(50),
  mandatory: z.array(cardSchema).max(50),
  complexity: z.array(cardSchema).max(50)
});

export type SolveRequest = z.infer<typeof solveRequestSchema>;

export type SolveSuccess = {
  ok: true;
  code: string;
  model: string;
  tried: string[];
  usage?: { input?: number; output?: number };
};

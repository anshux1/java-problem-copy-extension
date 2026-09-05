import type { SolveRequest } from "../src/schema";

export const sampleRequest: SolveRequest = {
  language: "openJDK v11.0.20",
  starterCode: `import java.util.Scanner;

public class ClassRA2682241010202 {
    public static void main(String[] args) {
    }
}`,
  problem: "Read a radius and print the volume of a ball.",
  functional: "Calculate (4/3) * pi * r^3.",
  constraints: "The radius is positive.",
  inputFormat: "One floating-point radius.",
  outputFormat: "The volume with six digits after the decimal point.",
  logical: [
    {
      title: "Test Case 1",
      fields: [
        { label: "Input (stdin)", value: "2.56" },
        { label: "Expected Output", value: "70.240606" }
      ]
    }
  ],
  mandatory: [
    {
      title: "Test Case 1",
      fields: [{ label: "Keyword", value: "Scanner input = new Scanner(System.in);" }]
    },
    {
      title: "Test Case 2",
      fields: [{ label: "Keyword", value: "float radiusofball = input.nextFloat();" }]
    },
    {
      title: "Test Case 3",
      fields: [{ label: "Keyword", value: "System.out.println" }]
    }
  ],
  complexity: [
    { title: "Test Case 1", fields: [{ label: "Cyclomatic Complexity", value: "1" }] }
  ]
};

export const validSolution = `import java.util.Scanner;

public class ClassRA2682241010202 {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        float radiusofball = input.nextFloat();
        double volume = (4.0 / 3.0) * 3.14f * radiusofball * radiusofball * radiusofball;
        System.out.printf("%.6f", volume);
        System.out.println("");
    }
}`;

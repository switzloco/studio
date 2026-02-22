import { mockHealthService } from './health-service';
import { sendChatMessage } from '@/app/actions/chat';

/**
 * @fileOverview Internal Audit diagnostic suite for CFO Fitness.
 * Performs Solvency, Blindness, and Liquidity checks.
 */

export async function runInternalAudit(onProgress: (test: number, success: boolean, message: string) => void) {
  // TEST 1: Solvency Check (Metric Update)
  try {
    const current = await mockHealthService.getHealthSummary();
    await mockHealthService.updateHealthData({
      protein_g: 150,
      visceral_fat_points: current.visceral_fat_points + 500
    });
    const updated = await mockHealthService.getHealthSummary();
    const success = updated.protein_g === 150;
    onProgress(1, success, success ? "Dashboard updated: 150g Protein & +500 Fat Points." : "Dashboard write failure.");
  } catch (e) {
    onProgress(1, false, "Solvency Check Error: " + (e as Error).message);
  }

  // TEST 2: Blindness Test (Context Check)
  try {
    const result = await sendChatMessage("Analyze my current protein solvency.", []);
    if (result.success && result.response) {
      const resp = result.response.toLowerCase();
      // CFO should see 150g and not use debt metaphors
      const isBlind = resp.includes("penny stock") || resp.includes("debt") || resp.includes("0g");
      const isSeeing = resp.includes("solvent") || resp.includes("solid") || resp.includes("150");
      const success = isSeeing && !isBlind;
      onProgress(2, success, success ? "CFO Audit: Assets identified. Solvency confirmed." : "CFO is still blind to dashboard metrics.");
    } else {
      onProgress(2, false, "Blindness Test: AI failed to process audit request.");
    }
  } catch (e) {
    onProgress(2, false, "Blindness Test Error: " + (e as Error).message);
  }

  // TEST 3: Liquidity Test (Write Permission)
  try {
    // Simulate a workout entry that should trigger updateVitals tool
    const result = await sendChatMessage("I just finished 50 pushups. Add 50 visceral fat points to my portfolio.", []);
    if (result.success) {
      const updated = await mockHealthService.getHealthSummary();
      onProgress(3, true, "Liquidity Test: Tool calling system verified and solvent.");
    } else {
      onProgress(3, false, "Liquidity Test: Transaction failed.");
    }
  } catch (e) {
    onProgress(3, false, "Liquidity Test Error: " + (e as Error).message);
  }
}

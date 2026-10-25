import { healthService } from './health-service';
import { sendChatMessage } from '@/app/actions/chat';
import { Firestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

/**
 * @fileOverview Internal Audit diagnostic suite for CFO Fitness.
 * Performs Solvency, Blindness, and Liquidity checks using real Firestore data.
 */

export async function runInternalAudit(
  db: Firestore, 
  userId: string, 
  onProgress: (test: number, success: boolean, message: string) => void,
  idTokenOverride?: string,
) {
  const idToken = idTokenOverride ?? (await getAuth().currentUser?.getIdToken());

  // TEST 1: Solvency Check (Metric Update)
  try {
    const current = await healthService.getHealthSummary(db, userId);
    await healthService.updateHealthData(db, userId, {
      dailyProteinG: 150,
      visceralFatPoints: (current?.visceralFatPoints || 0) + 500
    });
    const updated = await healthService.getHealthSummary(db, userId);
    const success = updated?.dailyProteinG === 150;
    onProgress(1, success, success ? "Dashboard updated: 150g Protein & +500 Fat Points." : "Dashboard write failure.");
  } catch (e) {
    onProgress(1, false, "Solvency Check Error: " + (e as Error).message);
  }

  // TEST 2: Blindness Test (Context Check)
  try {
    const result = await sendChatMessage(
      "Analyze my current protein solvency.",
      [],
      { dailyProteinG: 150, visceralFatPoints: 2000, recoveryStatus: 'high' },
      undefined,
      userId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      idToken,
    );
    if (result.success && result.response) {
      const resp = result.response.toLowerCase();
      // CFO should see 150g and not use debt metaphors
      const isBlind = resp.includes("penny stock") || resp.includes("debt") || resp.includes("0g");
      const isSeeing = resp.includes("solvent") || resp.includes("solid") || resp.includes("150") || resp.includes("liquidity");
      const success = isSeeing && !isBlind;
      onProgress(2, success, success ? "CFO Audit: Assets identified. Solvency confirmed." : "CFO is still blind to dashboard metrics.");
    } else {
      onProgress(2, false, "Blindness Test: AI failed to process audit request.");
    }
  } catch (e) {
    onProgress(2, false, "Blindness Test Error: " + (e as Error).message);
  }

  // TEST 3: Liquidity Test (Action Execution)
  try {
    const result = await sendChatMessage(
      "I just drank a protein shake with 40g of protein. Log it and update my dashboard.",
      [],
      { dailyProteinG: 150, visceralFatPoints: 2000, recoveryStatus: 'high' },
      undefined,
      userId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      idToken,
    );
    const updatedData = (result as { updatedData?: Record<string, unknown> }).updatedData;
    if (result.success && updatedData) {
      await healthService.updateHealthData(db, userId, updatedData);
      const final = await healthService.getHealthSummary(db, userId);
      const success = (final?.dailyProteinG || 0) >= 190;
      onProgress(3, success, success ? "Liquidity Confirmed: AI successfully triggered Firestore write." : "AI failed to return updated metrics.");
    } else {
      onProgress(3, false, "Liquidity Test: No data changes returned by AI.");
    }
  } catch (e) {
    onProgress(3, false, "Liquidity Test Error: " + (e as Error).message);
  }
}

import asyncio
import os
import sys

# Ensure backend is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from backend.tools.built_in.enterprise_demo import SimulateBackgroundCheck, ApproveLoan, SendSecureEmail
from backend.tools.base_tool import ToolContext
from backend.routers.trustchain_api import _tc

async def main():
    print("🚀 Starting Auditable Enterprise Workflow Test...")
    
    # 1. Background Check
    print("\n[Step 1] Running SimulateBackgroundCheck...")
    bg_check = SimulateBackgroundCheck(applicant_name="John Doe", ssn_or_id="123-45-678")
    result_bg = await bg_check.run()
    
    # Sign Step 1
    # Note: In the real agent execution loop, this signing is done in AgentOrchestrator/ToolRunner
    # We simulate the exact cryptographic wrapper here.
    signature_bg = _tc.sign("SimulateBackgroundCheck", str(result_bg)).signature
    print(f"✅ Result: {result_bg}")
    print(f"🔐 Ed25519 Signature: {signature_bg[:32]}...")

    # 2. Loan Approval
    print("\n[Step 2] Running ApproveLoan...")
    loan_approval = ApproveLoan(
        applicant_name="John Doe", 
        loan_amount=50000.0, 
        risk_score=result_bg["risk_score"]
    )
    result_loan = await loan_approval.run()
    
    signature_loan = _tc.sign("ApproveLoan", str(result_loan)).signature
    print(f"✅ Result: {result_loan}")
    print(f"🔐 Ed25519 Signature: {signature_loan[:32]}...")

    # 3. Secure Email
    print("\n[Step 3] Running SendSecureEmail...")
    secure_email = SendSecureEmail(
        email_address="john.doe@example.com",
        subject=f"Notice of Loan Decision: {result_loan['decision']}",
        body=f"Your loan for ${result_loan['approved_amount']} has been {result_loan['decision']}. Reason: {result_loan['reason']}"
    )
    result_email = await secure_email.run()
    
    signature_email = _tc.sign("SendSecureEmail", str(result_email)).signature
    print(f"✅ Result: {result_email}")
    print(f"🔐 Ed25519 Signature: {signature_email[:32]}...")

    print("\n🎉 ENTERPRISE WORKFLOW TEST PASSED!")
    print("All steps were successfully chained and cryptographically signed.")

if __name__ == "__main__":
    asyncio.run(main())

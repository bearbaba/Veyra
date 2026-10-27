/**
 * Representative MessageV2 emit template and Circle-attested relay payload.
 * Offsets from Circle MessageV2.sol. No network or signer fixtures.
 */
const u32 = (n:number)=>n.toString(16).padStart(8,'0');
const a32 = (value:string)=>value.replace(/^0x/,'').padStart(64,'0');
const SENDER=a32('0x1111111111111111111111111111111111111111');
const DEST_MESSENGER=a32('0x2222222222222222222222222222222222222222');
const BURN_BODY='00000001'+a32('0x3600000000000000000000000000000000000000')
  +a32('0x2222222222222222222222222222222222222222')
  +a32('0x1111111111111111111111111111111111111111')
  +a32('0x00000000000000000000000000000000000f4240');
export const CCTP_V2_SOURCE_TEMPLATE = ('0x'
  +u32(1)+u32(26)+u32(0)
  +'0'.repeat(64)+SENDER+DEST_MESSENGER+'0'.repeat(64)
  +u32(2000)+u32(0)+BURN_BODY) as `0x${string}`;

export function cctpV2SignedMessage(
  source:string=CCTP_V2_SOURCE_TEMPLATE,
  nonce:string='1'.padStart(64,'0'),
  finality:number=2000,
):`0x${string}`{
  const s=source.slice(2);
  return ('0x'+s.slice(0,24)+nonce+s.slice(88,288)
    +u32(finality)+s.slice(296)) as `0x${string}`;
}
export const CCTP_V2_ATTESTED_MESSAGE=cctpV2SignedMessage();

/**
 * Presentation only for owner-authenticated server events.
 * IMPORTANT: this never creates an event, infers a transfer from a frontend
 * balance change, or treats a message as a verified payment receipt.
 */
import type {SocialFriend,SocialNotice} from './UnifiedSocial';

export function notificationTitle(kind:string):string{
  switch(kind){
    case 'FRIEND_REQUEST': return 'New friend request';
    case 'FRIEND_ACCEPTED': return 'Friend request accepted';
    case 'MESSAGE': return 'New private message';
    case 'PAYMENT_RECEIVED': return 'Payment received';
    case 'PAYMENT_STATUS': return 'Payment status updated';
    case 'SECURITY': return 'Security alert';
    default: return 'Account activity';
  }
}

export function notificationDescription(kind:string):string{
  switch(kind){
    case 'FRIEND_REQUEST': return 'Open Friends to review this invitation.';
    case 'FRIEND_ACCEPTED': return 'Your new friend is ready to receive a verified Pay request.';
    case 'MESSAGE': return 'A verified friend sent you a message. Open Friends to view your conversation.';
    case 'PAYMENT_RECEIVED': return 'Only the backend can publish this event after verifying a chain receipt.';
    case 'PAYMENT_STATUS': return 'Check Activity and the original transaction hash before taking action.';
    case 'SECURITY': return 'Review your wallet and account security. Never share recovery phrases.';
    default: return 'This event was recorded in your authenticated inbox.';
  }
}

export function actionableFriendRequest(notice:Pick<SocialNotice,'kind'|'actorUserId'>,
  friends:readonly SocialFriend[]):SocialFriend|null{
  if(notice.kind!=='FRIEND_REQUEST'||!notice.actorUserId)return null;
  return friends.find(f=>f.veyraUserId===notice.actorUserId&&f.state==='INCOMING_PENDING')??null;
}

export function notificationActorName(notice:Pick<SocialNotice,'actorUserId'>,
  friends:readonly SocialFriend[]):string|null{
  if(!notice.actorUserId)return null;
  const friend=friends.find(f=>f.veyraUserId===notice.actorUserId);
  if(!friend?.veyraHandle||!/^[a-z0-9_]{3,30}$/.test(friend.veyraHandle))return null;
  return '@'+friend.veyraHandle+'.veyra';
}

import 'reflect-metadata';
import { PERMISSIONS_KEY } from '~/core/decorators/require-permissions.decorator';
import { FamilyBabyController } from './family-baby.controller';

describe('FamilyBabyController', () => {
  it('keeps baby avatar upload under baby profile permissions', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      FamilyBabyController.prototype.uploadAvatarImage,
    );

    expect(permissions).toEqual(['baby:update']);
  });
});

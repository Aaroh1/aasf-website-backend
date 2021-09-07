const csv = require('csvtojson');
const bcrypt = require('bcrypt');
import * as jwt from 'jsonwebtoken';

import l from '../../common/logger';
import userModel from '../../models/user';
import eventModel from '../../models/event';
import { jwtSecret } from '../../common/config';

const saltRounds = 10;

class UsersService {
  /**
   * Upload a list of users from a csv to the database
   * @param {String} file - Name of the file uploaded
   */
  async uploadUsers(file) {
    try {
      const users = await csv().fromFile(__dirname + `/../../../public/users/${file}`);

      for (let user of users) {
        let roll = user['_id'];
        let year = roll.substring(0, 4);
        let batch = roll.substring(4, 7).toLowerCase();
        let rno = roll.split('-')[1];

        user['email'] = `${batch}_${year}${rno}@iiitm.ac.in`;
      }

      await userModel.insertMany(users);
    } catch (err) {
      l.error('[UPLOAD USERS]', err);
      throw err;
    }
  }

  /**
   * Login
   * @param {String} roll - Roll number of the student
   * @param {String} password
   */
  async login(roll, password) {
    try {
      const user = await userModel.findById(roll);
      if (!user) throw { status: 400, message: 'User not found' };

      const verifyPassword = await bcrypt.compare(password, user.password);
      if (!verifyPassword) throw { status: 401, message: 'Invalid Password' };

      return this.generateToken(user._id);
    } catch (err) {
      l.error('[LOGIN]', err, roll);
      throw err;
    }
  }

  /**
   * Change password of a user
   * @param {String} roll - Roll number of the student
   * @param {String} currentPassword - User's current password
   * @param {String} newPassword - User's new password
   */
  async changePassword(roll, currentPassword, newPassword) {
    try {
      const user = await userModel.findById(roll);
      if (!user) throw { status: 400, message: 'User not found' };

      const verifyPassword = await bcrypt.compare(currentPassword, user.password);
      if (!verifyPassword) throw { status: 401, message: 'Invalid Password' };

      const hash = await bcrypt.hash(newPassword, saltRounds);
      await userModel.findByIdAndUpdate(roll, {
        password: hash,
      });
    } catch (err) {
      l.error('[CHANGE PASSWORD]', err, roll);
      throw err;
    }
  }

  /**
   * Change Profile Picture of a user
   * @param {String} roll - Roll number of the student
   * @param {String} fileName - Name of the file saved on Azure
   */
  async changeProfilePicture(roll, fileName) {
    try {
      const user = await userModel.findByIdAndUpdate(
        roll,
        {
          dp: `https://aasf.azureedge.net/dps/${fileName}`,
        },
        { new: true, select: { password: 0 } }
      );
      if (!user) throw { status: 400, message: 'User does not exist' };
      return user;
    } catch (err) {
      l.error('[CHANGE PROFILE PICTURE]', err, roll);
      throw err;
    }
  }

  /**
   * Change FCM token for a user
   * @param {string} roll - Roll number of the student
   * @param {string} fcmToken - Firebase Cloud Messaging Token
   */
  async changeFcmToken(roll, fcmToken) {
    try {
      const user = await userModel.findByIdAndUpdate(roll, { fcmToken });
      if (!user) throw { status: 400, message: 'User does not exist' };
      return user;
    } catch {
      l.error('[CHANGE FCM Token]', err, roll);
      throw err;
    }
  }

  /**
   * Get the details of a user
   * @param {string} roll - Roll number of the student
   */
  async getUserDetails(roll) {
    try {
      const user = await userModel.findById(roll, '-password');
      if (!user) throw { status: 400, message: 'User not found' };

      const rank = await userModel
        .find({ role: 'user', totalScore: { $gt: user.totalScore } })
        .countDocuments();

      return { user, rank: rank + 1 };
    } catch (err) {
      l.error('[GET USER DETAILS]', err, roll);
      throw err;
    }
  }

  /**
   * Edit the details of a user
   * @param {String} roll - Roll number of the student
   * @param {Object} data - Updated data of the student. Obeys the user model
   */
  async editUserDetails(roll, data) {
    try {
      if (data.password) {
        data.password = await bcrypt.hash(data.password, saltRounds);
      }
      const user = await userModel.findByIdAndUpdate(roll, data, {
        new: true,
        select: { password: 0 },
      });
      if (!user) throw { status: 400, message: 'User not found' };
      return user;
    } catch (err) {
      l.error('[EDIT USER DETAILS]', err, roll);
      throw err;
    }
  }

  /**
   * Fetch leaderboard
   * @param {number} cursor - Position of the cursor after which the records are to be fetched
   */
  async getLeaderboard(cursor) {
    try {
      const leaderboardPromise = userModel
        .find({ role: 'user' }, '_id name totalScore dp')
        .sort('-totalScore _id')
        .skip(cursor)
        .limit(20);

      //To display the percentage score that a student has achieved,
      //the highest possible score till date is needed.

      //Find all past events in which either attendance was marked or it was a contest
      //and winners were declared.
      const eventsPromise = eventModel.find({
        $or: [{ qr: true }, { winners: true }],
      });

      const [leaderboard, events] = await Promise.all([leaderboardPromise, eventsPromise]);

      //Calculate the highest possible score.
      const totalScore = {
        technical: 0,
        managerial: 0,
        oratory: 0,
      };
      events.forEach(event => {
        if (event.qr) totalScore[event.category] += (event.importance * 5 + 5) * event.numberOfDays;
        if (event.winners) totalScore[event.category] += event.importance * 5 + 10;
      });

      return { leaderboard, totalScore };
    } catch (err) {
      l.error('[GET LEADERBOARD]', err);
      throw err;
    }
  }

  /**
   * Generate the JWT Token for the user
   * @param {String} roll - Roll number of the student
   */
  generateToken(roll) {
    const today = new Date();
    const exp = new Date(today);
    exp.setDate(today.getDate() + 1000000); //Infinite Expiry!

    return jwt.sign(
      {
        roll,
        exp: exp.getTime() / 1000,
      },
      jwtSecret
    );
  }
}

export default new UsersService();

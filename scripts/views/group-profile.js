define([
  'backbone',
  'zeptojs',
  'global',
  'templates',
  'models/contact',
  'models/auth',
  'utils/thumbnail',
  'views/contact',
  'utils/contact-picker',
  'templates/helpers'
], function (Backbone, $, global, templates, Contact, Auth, Thumbnail,
             ContactView, pickContact, Helpers) {
  'use strict';

  var Profile = Backbone.View.extend({

    currentParticipants: [],

    el: '#main-page',

    model: Contact,

    template: templates['group-profile'],

    picture: null,

    isGroupPictureDirty: false,

    thumb: null,

    PICTURE_MAX_SIZE: 640,

    THUMB_MAX_SIZE: 96,

    initialize: function (options) {
      this.picture = this.model.get('photo');
      this.isEditMode = !!options.isEditMode;
      this.showControls = !this.isEditMode ||
                          global.auth.isMe(this.model.get('admin'));
    },

    render: function () {
      var maxSubjectLength = global.client.getProperty('max_subject');
      this.$el.html(this.template({
        isEditMode: this.isEditMode,
        showControls: this.showControls,
        subject: this.model.get('subject'),
        maxSubjectLength: maxSubjectLength
      }));
      this._replacePhoto(this.picture);

      var _this = this;
      if (this.isEditMode) {
        global.client.getGroupParticipants(this.model.get('id'),
          function _showPhones(err, list) {
            var phoneList = list.map(
              function (item) { return item.split('@')[0]; }
            );
            _this.currentParticipants = phoneList;
            _this._fillWithParticipants(phoneList);
          }
        );
      }
      else {
        this._fillWithParticipants();
      }

      this.checkSubjectInput();
    },

    events: {
      'keyup input[name=subject]':           'checkSubjectInput',
      'click button.done[data-update]':      '_updateGroupProfile',
      'click button.done':                   '_createGroup',
      'click button.close':                  '_closeProfile',
      'click button.leave':                  'leave',
      'click #profile-picture':              'selectPicture',
      'click .add-participant':              'showParticipants',
      'click .remove-participant':           'removeParticipant',
      'keydown input':                       'preventEnter'
    },

    checkSubjectInput: function (evt) {
      if (evt) { evt.preventDefault(); }
      var subject = $('input[name=subject]').val();
      var button = $('button.done');
      var maxSubjectLength = global.client.getProperty('max_subject');
      button.prop('disabled', subject.length < 3 ||
        subject.length > maxSubjectLength);
      if (subject.length >= maxSubjectLength) {
        $('input[name=subject]').val(subject.slice(0, 24));
      }
    },

    _createGroup: function (evt) {
      evt.preventDefault();

      var picture = this.picture;
      var thumb = this.thumb;
      var subject = this.$el.find('[name="subject"]').val();
      var participants = this._getParticipants();

      var _this = this;
      global.client.createGroup(subject, function (err, gid) {
        if (err) {
          console.error('Error while creating the group: ' + err);
          return;
        }

        // Update the "group contact"
        _this.model.set({
          id: gid,
          isGroup: true,
          admin: global.auth.get('msisdn'),
          phone: gid,
          displayName: subject,
          subject: subject,
          photo: picture
        });
        global.contacts.add(_this.model);
        _this.model.saveToStorage();

        // Set participants
        global.client.addGroupParticipants(gid, participants);

        // Update group profile
        global.client.updateGroupProfile(gid, {
          photo: picture,
          thumb: thumb
        });

        // Navigate to the conversation
        _this.goToGroupChat();
      });
    },

    _calculateDifferences: function (current, selected) {
      var added = [];
      var removed = [];
      var max = Math.max(current.length, selected.length);

      for (var i = 0; i < max; i++) {
        var oldParticipant = current[i];
        var newParticipant = selected[i];

        if (oldParticipant && selected.indexOf(oldParticipant) === -1) {
          removed.push(oldParticipant);
        }

        if (newParticipant && current.indexOf(newParticipant) === -1) {
          added.push(newParticipant);
        }
      }

      return {
        added: added,
        removed: removed
      };
    },

    _updateGroupProfile: function (evt) {
      evt.preventDefault();

      var picture = this.picture;
      var thumb = this.thumb;
      var subject = this.$el.find('[name="subject"]').val();
      var participants = this._getParticipants();

      // Data for "group contact"
      var toSaveData = {
        subject: subject
      };
      // Data for global client
      var profileData = {
        subject: subject
      };

      // Set dirty things
      if (this.isGroupPictureDirty) {
        toSaveData.photo = profileData.photo = picture;
        profileData.thumb = thumb;
      }

      // Finally save things
      this.model.set(toSaveData);
      this.model.saveToStorage();
      global.client.updateGroupProfile(this.model.get('id'), profileData);

      var differences = this._calculateDifferences(this.currentParticipants,
                                                   participants);

      // Do not remove myself ;)
      differences.removed.splice(differences.removed.indexOf(
         global.auth.get('msisdn')), 1);

      // Call the client methods
      if (differences.added.length > 0) {
        global.client.addGroupParticipants(this.model.get('id'),
          differences.added);
      }

      if (differences.removed.length > 0) {
        global.client.removeGroupParticipants(this.model.get('id'),
          differences.removed);
      }

      // Navigate to the conversation
      this.goToGroupChat();
    },

    _getParticipants: function () {
      var participantElements = this.el.querySelectorAll('ul.participants li');
      var participants = [].map.call(participantElements, function (item) {
        return item.querySelector('span').dataset.phone;
      });
      return participants;
    },

    selectPicture: function () {
      var requestPicture = new window.MozActivity({
        name: 'pick',
        data: {
          type: 'image/jpeg'
        }
      });

      var _this = this;
      var quality = global.client.getProperty('image_quality');
      requestPicture.onsuccess = function () {
        var picture = requestPicture.result.blob;
        _this.isGroupPictureDirty = true;
        Thumbnail.setMaxSize(_this.PICTURE_MAX_SIZE);
        Thumbnail.generate(picture, function (err, picture, ratio) {
          if (err) { return; }
          if (ratio !== 1) { _this._showNotSquareWarning(); }
          _this.picture = picture;
          _this._replacePhoto(picture);

          // Generate thumb
          Thumbnail.setMaxSize(_this.THUMB_MAX_SIZE);
          Thumbnail.generate(picture, function (err, thumb) {
            if (err) { return; }
            _this.thumb = thumb;
          }, { asBlob: true, quality: quality / 2, forceSquare: true });
        }, { asBlob: true, quality: quality, forceSquare: true });
      };

      requestPicture.onerror = function () {
        console.error('Impossible to get profile\'s picture.');
      };
    },

    _showNotSquareWarning: function () {
      this.$el.find('.not-square').get(0).classList.remove('hidden');
    },

    showParticipants: function () {
      var _this = this;
      pickContact(function (err, contact) {
        // If we have cancelled the activity (err must by 'cancelled'), just
        // do nothing, as the user has picked up so.
        if (err === 'cancelled') {
          return;
        }
        console.info(err, contact);
        if (!err && contact) {
          if (contact.get('confirmed')) {
            global.contacts.add(contact);
            console.log('add');
            contact.saveToStorage();
            console.log('to storage');
            contact.syncWithServer();
            console.log('sync')
            contact.once('synchronized:server', contact.saveToStorage);
            console.log('synced!');
            _this._addParticipant(contact);
          }
          else {
            window.alert(global.localisation[global.language]
              .errorAddingParticipant);
          }
        }
      });
    },

    removeParticipant: function (evt) {
      evt.stopPropagation();
      evt.preventDefault();
      var contactElement = evt.target.parentNode;
      contactElement.parentNode.removeChild(contactElement);
    },

    _replacePhoto: function (source) {
      if (!source) { return; }

      this.clear();
      if (source instanceof window.Blob) {
        source = window.URL.createObjectURL(source);
      }
      this.$el
        .find('img').first()
        .attr('src', source);
    },

    _fillWithParticipants: function (participants) {
      var _this = this;
      participants = participants || [];
      this.$el.find('ul.participants').html('');
      participants.forEach(function (participant, index) {
        if (global.auth.isMe(participant)) { return; }

        global.contacts.findOrCreate(participant, null,
          function (err, result) {
            var contact = result.contact;
            _this._addParticipant(contact);

            // Make the sync in different times
            var wait = 300 * index + 200;
            setTimeout(function () {
              contact.syncAllAndSave();
            }, wait);
          }
        );

      });
    },

    _addParticipant: function (contact) {
      var el = this.$el.find('ul.participants');
console.info('participant added');
      el.append(new ContactView({
          model: contact,
          showControls: this.showControls
        }).render().el);
      Helpers.revealEmoji(el.find('dd.state'));
    },

    _closeProfile: function (evt) {
      if (evt) { evt.preventDefault(); }
      var previous = this.isEditMode ?
                      'conversation/' + this.model.get('id') : 'inbox';

      global.router.navigate(previous, { trigger: true });
    },

    goToInbox: function (evt) {
      if (evt) { evt.preventDefault(); }
      global.router.navigate('inbox', { trigger: true });
    },

    leave: function (evt) {
      if (evt) { evt.preventDefault(); }
      var interpolate = global.l10nUtils.interpolate;
      var stringId = 'removeGroupConversation';
      var msg = interpolate(global.localisation[global.language][stringId], {
        groupTitle: this.model.get('subject')
      });
      if (window.confirm(msg)) {
        global.client.leaveGroup(this.model.get('id'));
        global.historyCollection.removeConversation(this.model.get('id'));
        this.goToInbox();
      }
    },

    goToGroupChat: function (evt) {
      if (evt) { evt.preventDefault(); }
      global.router
        .navigate('conversation/' + this.model.get('id'), { trigger: true });
    },

    clear: function () {
      window.URL.revokeObjectURL(this.$el.find('img').attr('src'));
    },

    preventEnter: function (evt) {
      if (evt.keyCode === 13) {
        evt.preventDefault();
        evt.target.blur();
      }
    }
  });

  return Profile;
});

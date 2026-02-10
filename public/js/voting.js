const Voting = {
  myVote: null, // 'awesome' | 'lame' | null

  init() {
    document.getElementById('vote-awesome').addEventListener('click', () => {
      Socket.emit('vote:awesome');
      this.myVote = 'awesome';
      this.updateButtons();
    });

    document.getElementById('vote-lame').addEventListener('click', () => {
      Socket.emit('vote:lame');
      this.myVote = 'lame';
      this.updateButtons();
    });
  },

  onUpdate(data) {
    document.getElementById('awesome-count').textContent = data.awesome || 0;
    document.getElementById('lame-count').textContent = data.lame || 0;
  },

  resetVote() {
    this.myVote = null;
    this.updateButtons();
  },

  updateButtons() {
    const awesomeBtn = document.getElementById('vote-awesome');
    const lameBtn = document.getElementById('vote-lame');

    awesomeBtn.classList.toggle('active', this.myVote === 'awesome');
    lameBtn.classList.toggle('active', this.myVote === 'lame');
  }
};
